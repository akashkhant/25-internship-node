const mongoose = require('mongoose');
const Booking = require("../models/BookModel");
const OwnerParking = require("../models/OwnerParkingModel");

// Helper function to validate owner and get parking IDs
const validateOwner = async (ownerId) => {
    if (!mongoose.Types.ObjectId.isValid(ownerId)) {
        throw new Error("Invalid owner ID format");
    }
    try {
        const ownerParkings = await OwnerParking.find({ parkingownerId: ownerId });
        if (!ownerParkings || ownerParkings.length === 0) {
            return [];
        }
        return ownerParkings.map(parking => parking._id);
    } catch (error) {
        throw new Error("Error validating owner parkings: " + error.message);
    }
};

// Helper function for consistent error responses
const handleError = (res, error, message = "An error occurred") => {
    console.error(`Error: ${message}`, error);
    return res.status(500).json({
        success: false,
        message: message,
        error: error.message
    });
};

const getBookingAnalytics = async (req, res) => {
    try {
        const { ownerId } = req.params;
        if (!ownerId) {
            return res.status(200).json({
                success: true,
                data: [] // Return empty array instead of error for no ownerId
            });
        }

        const parkingIds = await validateOwner(ownerId);
        
        const bookings = await Booking.find({
            ownerparkingId: { $in: parkingIds }
        })
        .sort({ startTime: -1 })
        .limit(10)
        .populate('userId', 'firstname lastname email')
        .populate('vehicleId', 'registrationNumber vehicleType')
        .populate('ownerparkingId', 'parkingname')
        .lean();

        // Transform data to ensure consistent structure
        const formattedBookings = (bookings || []).map(booking => ({
            id: booking._id?.toString(),
            userName: `${booking.userId?.firstname || ''} ${booking.userId?.lastname || ''}`.trim(),
            vehicleNumber: booking.vehicleId?.registrationNumber || '',
            vehicleType: booking.vehicleType || '',
            parkingName: booking.ownerparkingId?.parkingname || '',
            startTime: booking.startTime,
            endTime: booking.endTime,
        }));

        return res.status(200).json({
            success: true,
            data: formattedBookings
        });
    } catch (error) {
        return handleError(res, error, "Failed to fetch booking analytics");
    }
};

const getRevenueAnalytics = async (req, res) => {
    try {
        const { ownerId } = req.params;
        if (!ownerId) {
            return res.status(200).json({
                success: true,
                data: {
                    total: 0,
                    monthly: 0,
                    bookings: []
                }
            });
        }

        const parkingIds = await validateOwner(ownerId);
        
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const bookings = await Booking.find({
            ownerparkingId: { $in: parkingIds }
        }).lean();

        // Calculate revenue manually to handle edge cases
        const revenue = bookings.reduce((acc, booking) => {
            const amount = booking.hourlyRate || 0;
            const isThisMonth = new Date(booking.startTime) >= startOfMonth;
            
            return {
                total: acc.total + amount,
                monthly: isThisMonth ? acc.monthly + amount : acc.monthly
            };
        }, { total: 0, monthly: 0 });

        return res.status(200).json({
            success: true,
            data: {
                total: revenue.total,
                monthly: revenue.monthly,
                bookings: bookings.map(b => ({
                    id: b._id?.toString(),
                    amount: b.hourlyRate || 0,
                    date: b.startTime
                }))
            }
        });
    } catch (error) {
        return handleError(res, error, "Failed to fetch revenue analytics");
    }
};

const getVehicleTypes = async (req, res) => {
    try {
        const { ownerId } = req.params;
        if (!ownerId) {
            return res.status(200).json({
                success: true,
                data: [] // Return empty array for consistency
            });
        }

        const parkingIds = await validateOwner(ownerId);
        
        const bookings = await Booking.find({
            ownerparkingId: { $in: parkingIds }
        }).lean();

        // Calculate vehicle types manually for better control
        const vehicleTypes = bookings.reduce((acc, booking) => {
            const type = booking.vehicleType || 'Unknown';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        // Transform to expected array format
        const formattedData = Object.entries(vehicleTypes).map(([type, count]) => ({
            vehicleType: type,
            count: count
        }));

        return res.status(200).json({
            success: true,
            data: formattedData
        });
    } catch (error) {
        return handleError(res, error, "Failed to fetch vehicle types");
    }
};

const getUtilization = async (req, res) => {
    try {
        const { ownerId } = req.params;
        if (!ownerId) {
            return res.status(400).json({
                success: false,
                message: "Owner ID is required"
            });
        }

        const parkingIds = await validateOwner(ownerId);
        const now = new Date();

        const [ownerParkings, activeBookings] = await Promise.all([
            OwnerParking.find({ _id: { $in: parkingIds } })
                .select('totalCapacityTwoWheeler totalCapacityFourWheeler')
                .lean(),
            Booking.countDocuments({
                ownerparkingId: { $in: parkingIds },
                startTime: { $lte: now },
                endTime: { $gt: now }
            })
        ]);

        const totalCapacity = ownerParkings.reduce((acc, parking) => 
            acc + (parking.totalCapacityTwoWheeler || 0) + (parking.totalCapacityFourWheeler || 0), 0);

        const utilization = totalCapacity ? (activeBookings / totalCapacity) * 100 : 0;

        return res.status(200).json({
            success: true,
            message: "Utilization data fetched successfully",
            data: {
                current: Math.round(utilization * 100) / 100,
                total: totalCapacity,
                activeBookings
            }
        });
    } catch (error) {
        return handleError(res, error, "Failed to fetch utilization data");
    }
};

module.exports = {
    getBookingAnalytics,
    getRevenueAnalytics,
    getVehicleTypes,
    getUtilization
};

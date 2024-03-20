const mongoose = require('mongoose');

const BlockchainMonitoringSchema = new mongoose.Schema({
    active: {
        type: Boolean,
        required: true
    },
    address: {
        type: String,
        unique: true,
        required: true
    },
    project: {
        type: String
    },
    description: {
        type: String
    },
    lastQueryTxId: {
        type: Number,
        default: 1
    },
    lastQuery: {
        type: Date
    },
    zeroQueries: {
        type: Number,
        default: 0
    },
    priority: {
        type: Number,
        default: 1
    },
    processRefunds: {
        type: Boolean,
        default: true
    }
}, {timestamps: true, collection: 'BlockchainMonitoring' });


module.exports = mongoose.model('BlockchainMonitoring', BlockchainMonitoringSchema);

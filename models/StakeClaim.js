const mongoose = require('mongoose');

const StakeClaimSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true
    },
    stakeAddress: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['OPEN', 'PROCESSING', 'EXPIRED', 'INVALID', 'COMPLETED', 'ERROR'],
        required: true
    },
    error: {
        type: String,
    },
    paymentAddress: {
        type: String,
        required: true
    },
    paymentAmount: {
        type: Number,
        required: true
    },
    serviceFee: {
        type: Number,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    assets: {
        type: Object,
        required: true
    },
    assetsReadable: {
        type: Object,
        required: true
    },
    delegatorRewards: {
        type: Object,
        required: true
    },
    assetRewards: {
        type: Object,
        required: true
    },
    epoch: {
        type: Number,
        required: true
    },
    month: {
        type: Number,
        required: true
    },
    quarter: {
        type: Number,
        required: true
    },
    year: {
        type: Number,
        required: true
    },
    paymentHash: {
        type: String
    },
    actionHash: {
        type: String
    }
}, {timestamps: true, minimize: false, collection: 'StakeClaim' });

module.exports = mongoose.model('StakeClaim', StakeClaimSchema);

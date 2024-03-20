const mongoose = require('mongoose');

const StakeRewardSchema = new mongoose.Schema({
    assetId: {
        type: String,
        required: true
    },
    decimals: {
        type: Number,
        required: true,
        default: 0
    },
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
    },
    image: {
        type: String,
    },
    active: {
        type: Boolean,
        required: true,
        default: true
    },
    exclusive: {
        type: Boolean,
        default: false
    },
    url: {
        type: String,
    },
    balance: {
        type: Number,
        required: true
    },
    reservedBalance: {
        type: Number,
        required: true
    },
    delegatorReward: {
        type: Boolean,
        required: true,
        default: false
    },
    delegatorRewardAmountPerEpoch: {
        type: Number,
        required: true
    },
    totalClaims: {
        type: Number,
        required: true
    },
    totalClaimedAmount: {
        type: Number,
        required: true
    }
}, {timestamps: true, collection: 'StakeReward' });

module.exports = mongoose.model('StakeReward', StakeRewardSchema);

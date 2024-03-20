const mongoose = require('mongoose');

const StakeAssetSchema = new mongoose.Schema({
    assetId: {
        type: String,
        required: true
    },
    project: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    image: {
        type: String,
        required: true
    },
    active: {
        type: Boolean,
        required: true,
        default: true
    },
    lastClaim: {
        type: Date,
        required: true
    },
    maximumReward: {
        type: Number,
    },
    reward: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StakeReward',
        required: true
    },
    rewardAmountPerDay: {
        type: Number,
        required: true
    },
    totalClaims: {
        type: Number,
        required: true,
    },
    totalClaimedAmount: {
        type: Number,
        required: true,
    }
}, {timestamps: true, collection: 'StakeAsset' });

module.exports = mongoose.model('StakeAsset', StakeAssetSchema);
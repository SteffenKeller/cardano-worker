function slotForDate(date) {
    const ms = Math.floor(date.getTime() / 1000)
    return ms-1591566291
}
exports.slotForDate = slotForDate

function dateFromSlot(slot) {
    const ms = 1591566291+slot
    const date = new Date(ms*1000);
    return date
}
exports.dateFromSlot = dateFromSlot

function hex2a(hex) {
    var str = '';
    for (var i = 0; i < hex.length; i += 2) {
        var v = parseInt(hex.substr(i, 2), 16);
        if (v) str += String.fromCharCode(v);
    }
    return str;
}
exports.hex2a = hex2a

exports.zeroPad = (num, places) => String(num).padStart(places, '0')

exports.sleep = (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const ALARM_NAME = 'iss_check_alarm';
const CHECK_INTERVAL_MIN = 5;
const NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown to prevent spam
const CLOSE_THRESHOLD = 800; // km

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: CHECK_INTERVAL_MIN
    });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        await checkProximity();
    }
});

async function checkProximity() {
    try {
        // 1. Get User Location & Cached ISS position
        const storageData = await chrome.storage.local.get([
            'user_geo_cache_minimal',
            'iss_pos_cache_minimal',
            'last_notification_time'
        ]);
        const userLoc = storageData.user_geo_cache_minimal ? storageData.user_geo_cache_minimal.payload : null;

        if (!userLoc) return;

        const cachedIss = storageData.iss_pos_cache_minimal;
        let issData = null;

        if (cachedIss && (Date.now() - cachedIss.timestamp < 15000)) {
            issData = {
                latitude: cachedIss.payload.lat,
                longitude: cachedIss.payload.lon
            };
        } else {

            const response = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
            if (!response.ok) return;
            issData = await response.json();
        }

        // 3. Calculate Distance
        const dist = calculateDistance(userLoc.lat, userLoc.lon, issData.latitude, issData.longitude);

        // 4. Check Threshold & Cooldown
        if (dist <= CLOSE_THRESHOLD) {
            const lastTime = storageData.last_notification_time || 0;
            const now = Date.now();

            if (now - lastTime > NOTIFICATION_COOLDOWN_MS) {
                sendNotification(dist);
                chrome.storage.local.set({ 'last_notification_time': now });
            }
        }

    } catch (e) {
        console.error('Background check failed', e);
    }
}

function sendNotification(distance) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'ISS is Overhead!',
        message: `Look up! The Space Station is passing by. Distance: ${Math.round(distance)} km`,
        priority: 2,
        requireInteraction: false
    }, (notificationId) => {
        if (notificationId) {
            setTimeout(() => {
                chrome.notifications.clear(notificationId);
            }, 25000);
        }
    });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(deg) {
    return deg * (Math.PI / 180);
}

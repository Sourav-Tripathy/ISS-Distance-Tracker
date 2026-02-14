
let currentUserPos = null;
let updateInterval = null;
let lastUpdateTime = null;

document.addEventListener('DOMContentLoaded', () => {
    initTracker();

});

async function initTracker() {
    const distanceEl = document.getElementById('iss-distance');
    const distanceNum = document.getElementById('distance-number');
    const userCoordsEl = document.getElementById('user-coords');
    const issCoordsEl = document.getElementById('iss-coords');
    const distanceNote = document.getElementById('distance-note');
    const connectionStatus = document.getElementById('connection-status');
    const distanceCard = document.getElementById('distance-card');

    //  Configuration
    const RATE_LIMIT_WINDOW = 2000;
    const POLL_INTERVAL = 5000;
    const IP_CACHE_KEY = 'user_geo_cache_minimal';
    const ISS_CACHE_KEY = 'iss_pos_cache_minimal';

    // Thresholds for display states (in km)
    const VISIBLE_THRESHOLD = 2300; // Horizon (approximate visibility range)
    const CLOSE_THRESHOLD = 800;    // High elevation pass (good viewing)
    const OVERHEAD_THRESHOLD = 50;  // Direct zenith pass (extremely rare)

    let isRequestPending = false;
    let wasOverheadLastTime = false;

    function getCached(key, ttlMs) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                if (!result[key]) {
                    resolve(null);
                    return;
                }
                const data = result[key];
                if (Date.now() - data.timestamp < ttlMs) {
                    resolve(data.payload);
                } else {
                    resolve(null);
                    return;
                }
            });
        });
    }

    function setCached(key, payload) {
        return new Promise((resolve) => {
            chrome.storage.local.set({
                [key]: {
                    timestamp: Date.now(),
                    payload: payload
                }
            }, () => resolve());
        });
    }



    function formatCoords(lat, lon) {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
    }

    async function getIPLocation() {
        // Helper with timeout
        async function fetchJSON(url, timeout = 3000) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            try {
                const response = await fetch(url, { signal: controller.signal });
                return response;
            } finally {
                clearTimeout(id);
            }
        }

        const providers = [
            async () => {
                const r = await fetchJSON("https://ipwho.is/");
                if (!r.ok) throw new Error('ipwho blocked');
                const j = await r.json();
                if (!j.success) throw new Error('ipwho failed');
                return { lat: j.latitude, lon: j.longitude };
            },
            async () => {
                const r = await fetchJSON("https://ipapi.co/json/");
                if (!r.ok) throw new Error('ipapi blocked');
                const j = await r.json();
                if (j.error) throw new Error(j.reason || 'ipapi error');
                return { lat: j.latitude, lon: j.longitude };
            },
            async () => {
                const r = await fetchJSON("https://ipinfo.io/json");
                if (!r.ok) throw new Error('ipinfo blocked');
                const j = await r.json();
                if (!j.loc) throw new Error('ipinfo missing loc');
                const [lat, lon] = j.loc.split(",");
                return { lat: +lat, lon: +lon };
            },
            async () => {
                const r = await fetchJSON("https://freeipapi.com/api/json");
                if (!r.ok) throw new Error('freeipapi blocked');
                const j = await r.json();
                return { lat: j.latitude, lon: j.longitude };
            }
        ];

        for (const p of providers) {
            try {
                const result = await p();
                if (result && !isNaN(result.lat) && !isNaN(result.lon)) {
                    return result;
                }
            } catch (e) {
                console.warn("Provider failed, trying next...", e);
            }
        }
        return null;
    }

    // Get User Location
    const cachedUserLoc = await getCached(IP_CACHE_KEY, 3600 * 1000);
    if (cachedUserLoc) {
        currentUserPos = cachedUserLoc;
        userCoordsEl.textContent = formatCoords(currentUserPos.lat, currentUserPos.lon);
    } else {
        userCoordsEl.textContent = 'Detecting...';

        try {
            const loc = await getIPLocation();
            if (loc) {
                currentUserPos = loc;
                await setCached(IP_CACHE_KEY, currentUserPos);
                userCoordsEl.textContent = formatCoords(currentUserPos.lat, currentUserPos.lon);
            } else {
                throw new Error("All location providers failed");
            }
        } catch (e) {
            console.error("Location detection error:", e);
            userCoordsEl.textContent = 'Location unavailable';
        }
    }

    // ISS Update Function
    async function updateISS() {
        if (isRequestPending) return;

        const cachedIss = await getCached(ISS_CACHE_KEY, RATE_LIMIT_WINDOW);
        let issLat, issLon;

        if (cachedIss) {
            issLat = cachedIss.lat;
            issLon = cachedIss.lon;
            renderISS(issLat, issLon);
            return;
        }

        isRequestPending = true;
        if (connectionStatus) connectionStatus.textContent = 'Updating...';

        try {
            const issRes = await fetch('https://api.wheretheiss.at/v1/satellites/25544');

            if (issRes.status === 429) throw new Error('Rate limit');
            if (!issRes.ok) throw new Error('API failed');

            const issData = await issRes.json();
            issLat = issData.latitude;
            issLon = issData.longitude;

            await setCached(ISS_CACHE_KEY, { lat: issLat, lon: issLon });
            if (connectionStatus) connectionStatus.textContent = 'Connected';

            distanceEl.classList.remove('loading', 'error');
            renderISS(issLat, issLon);

        } catch (e) {
            console.error('ISS Update Error:', e);

            const staleIss = await getCached(ISS_CACHE_KEY, 60000);
            if (staleIss) {
                if (connectionStatus) connectionStatus.textContent = 'Using cache';
                distanceEl.classList.add('loading');
                renderISS(staleIss.lat, staleIss.lon);
            } else {
                if (connectionStatus) connectionStatus.textContent = 'Disconnected';
                distanceEl.classList.remove('loading');
                distanceEl.classList.add('error');
                distanceNum.textContent = 'No signal';
                issCoordsEl.textContent = '—';
                distanceNote.textContent = 'Unable to connect to ISS tracking service';
            }
        } finally {
            isRequestPending = false;
        }
    }

    // Render Function
    function renderISS(issLat, issLon) {
        issCoordsEl.textContent = formatCoords(issLat, issLon);
        distanceCard.classList.remove('overhead', 'nearby');

        if (currentUserPos) {
            // Calculate ground distance using Haversine
            const R = 6371;
            const dLat = (issLat - currentUserPos.lat) * Math.PI / 180;
            const dLon = (issLon - currentUserPos.lon) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(currentUserPos.lat * Math.PI / 180) *
                Math.cos(issLat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const groundDistance = R * c;

            const roundedDistance = Math.round(groundDistance);

            if (roundedDistance <= OVERHEAD_THRESHOLD) {
                distanceCard.classList.add('overhead');
                distanceNote.innerHTML = 'Zenith Pass! ISS is directly above you.';
            } else if (roundedDistance <= CLOSE_THRESHOLD) {
                distanceCard.classList.add('overhead');
                distanceNote.innerHTML = 'Close Flyby. High in the sky. Look up!';
            } else if (roundedDistance <= VISIBLE_THRESHOLD) {
                distanceCard.classList.add('nearby');
                distanceNote.innerHTML = 'Above Horizon. In range, but low in the sky.';
            } else {
                distanceNote.innerHTML = 'ISS follows a fixed track while Earth spins, so most passes are "flybys" to your side.';
            }

            distanceNum.textContent = roundedDistance.toLocaleString();
            wasOverheadLastTime = (roundedDistance <= CLOSE_THRESHOLD);

        } else {
            distanceNum.textContent = '—';
            distanceNote.textContent = 'Enable location to calculate distance';
        }
    }

    await updateISS();

    updateInterval = setInterval(async () => {
        await updateISS();
    }, POLL_INTERVAL);
}

window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});
// ISS Distance Tracker - Minimal & Aesthetic
// Clean, professional design inspired by personal website

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
    const updateTimeEl = document.getElementById('update-time');
    const distanceCard = document.getElementById('distance-card');

    // Configuration
    const RATE_LIMIT_WINDOW = 2000;
    const POLL_INTERVAL = 5000;
    const IP_CACHE_KEY = 'user_geo_cache_minimal';
    const ISS_CACHE_KEY = 'iss_pos_cache_minimal';
    const OVERHEAD_THRESHOLD = 500;

    let isRequestPending = false;
    let wasOverheadLastTime = false;

    // Helper functions
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

    function updateTimeDisplay() {
        if (!lastUpdateTime) return;
        const now = new Date();
        const diffMs = now - lastUpdateTime;
        const diffSec = Math.floor(diffMs / 1000);
        
        if (diffSec < 10) {
            updateTimeEl.textContent = 'Just now';
        } else if (diffSec < 60) {
            updateTimeEl.textContent = `${diffSec}s ago`;
        } else if (diffSec < 3600) {
            updateTimeEl.textContent = `${Math.floor(diffSec / 60)}m ago`;
        } else {
            updateTimeEl.textContent = lastUpdateTime.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit'
            });
        }
    }

    function formatCoords(lat, lon) {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
    }

    // Get User Location
    const cachedUserLoc = await getCached(IP_CACHE_KEY, 3600 * 1000);
    if (cachedUserLoc) {
        currentUserPos = cachedUserLoc;
        userCoordsEl.textContent = formatCoords(currentUserPos.lat, currentUserPos.lon);
    } else {
        userCoordsEl.textContent = 'Detecting...';
        try {
            const ipRes = await fetch('https://ipwho.is/');
            if (ipRes.ok) {
                const ipData = await ipRes.json();
                if (ipData.success) {
                    currentUserPos = { lat: ipData.latitude, lon: ipData.longitude };
                    await setCached(IP_CACHE_KEY, currentUserPos);
                    userCoordsEl.textContent = formatCoords(currentUserPos.lat, currentUserPos.lon);
                }
            }
        } catch (e) {
            try {
                const res2 = await fetch('https://ipapi.co/json/');
                if (res2.ok) {
                    const data2 = await res2.json();
                    if (data2.latitude && data2.longitude) {
                        currentUserPos = { lat: data2.latitude, lon: data2.longitude };
                        await setCached(IP_CACHE_KEY, currentUserPos);
                        userCoordsEl.textContent = formatCoords(currentUserPos.lat, currentUserPos.lon);
                    }
                }
            } catch (e2) {
                userCoordsEl.textContent = 'Location unavailable';
            }
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
        connectionStatus.textContent = 'Updating...';
        
        try {
            const issRes = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
            
            if (issRes.status === 429) throw new Error('Rate limit');
            if (!issRes.ok) throw new Error('API failed');

            const issData = await issRes.json();
            issLat = issData.latitude;
            issLon = issData.longitude;

            await setCached(ISS_CACHE_KEY, { lat: issLat, lon: issLon });
            lastUpdateTime = new Date();
            updateTimeDisplay();
            connectionStatus.textContent = 'Connected';
            
            distanceEl.classList.remove('loading', 'error');
            renderISS(issLat, issLon);

        } catch (e) {
            console.error('ISS Update Error:', e);
            
            const staleIss = await getCached(ISS_CACHE_KEY, 60000);
            if (staleIss) {
                connectionStatus.textContent = 'Using cache';
                distanceEl.classList.add('loading');
                renderISS(staleIss.lat, staleIss.lon);
            } else {
                connectionStatus.textContent = 'Disconnected';
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
        distanceCard.classList.remove('overhead');

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
            const isOverhead = groundDistance <= OVERHEAD_THRESHOLD;

            // Update display
            distanceNum.textContent = roundedDistance.toLocaleString();
            
            if (isOverhead && !wasOverheadLastTime) {
                distanceCard.classList.add('overhead');
                distanceNote.innerHTML = '<strong>ISS is directly overhead</strong> · Ground distance: 0 km · Altitude: ~408 km';
            } else if (isOverhead) {
                distanceCard.classList.add('overhead');
                distanceNote.innerHTML = '<strong>ISS is overhead</strong> · Look up! 408 km above you';
            } else {
                distanceNote.textContent = 'When ISS is directly above you, ground distance becomes 0 km (altitude: ~408 km)';
            }

            wasOverheadLastTime = isOverhead;
        } else {
            distanceNum.textContent = '—';
            distanceNote.textContent = 'Enable location to calculate distance';
        }
    }

    // Initial call
    await updateISS();
    
    // Set up interval
    updateInterval = setInterval(async () => {
        await updateISS();
        updateTimeDisplay();
    }, POLL_INTERVAL);

    // Update time display every second
    setInterval(updateTimeDisplay, 1000);
}

// Clean up
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});
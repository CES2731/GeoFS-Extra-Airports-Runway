// ========== 请修改为您的 GitHub JSON 文件 raw 地址 ==========
const RUNWAYS_JSON_URL = 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/test.json';
// ============================================================

(async function() {
    if (typeof geofs === 'undefined' || !geofs.majorRunwayGrid) {
        console.error('❌ 错误：未找到 geofs.majorRunwayGrid，请确认在 GeoFS 游戏页面运行');
        return;
    }

    // 辅助函数：将经纬度转换为网格键（整数部分）
    function getGridKey(coord) {
        let key = Math.trunc(coord);
        if (key === -0) key = 0;
        return String(key);
    }

    // 查找附近已有跑道的网格（用于保持分组一致性）
    function findClosestRunwayGrid(lat, lon) {
        const EARTH_RADIUS = 6371;
        const toRad = Math.PI / 180;
        let minDist = Infinity;
        let targetLatKey = null, targetLonKey = null;
        for (const [latKey, lonGrid] of Object.entries(geofs.majorRunwayGrid)) {
            for (const [lonKey, runways] of Object.entries(lonGrid)) {
                for (const r of runways) {
                    const rLat = r[4], rLon = r[5];
                    if (rLat === undefined || rLon === undefined) continue;
                    const dLat = (rLat - lat) * toRad;
                    const dLon = (rLon - lon) * toRad;
                    const a = Math.sin(dLat/2)**2 + Math.cos(lat*toRad)*Math.cos(rLat*toRad)*Math.sin(dLon/2)**2;
                    const dist = EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    if (dist < minDist) {
                        minDist = dist;
                        targetLatKey = latKey;
                        targetLonKey = lonKey;
                    }
                }
            }
        }
        return { latKey: targetLatKey, lonKey: targetLonKey };
    }

    // 添加单条跑道
    function addRunway(icao, length, width, heading, lat, lon, elevation = 0) {
        if (!icao || typeof icao !== 'string') return false;
        if (length <= 0 || width <= 0) return false;

        let latKey = getGridKey(lat);
        let lonKey = getGridKey(lon);
        const nearest = findClosestRunwayGrid(lat, lon);
        if (nearest.latKey && nearest.lonKey) {
            latKey = nearest.latKey;
            lonKey = nearest.lonKey;
        }

        if (!geofs.majorRunwayGrid[latKey]) geofs.majorRunwayGrid[latKey] = {};
        if (!geofs.majorRunwayGrid[latKey][lonKey]) geofs.majorRunwayGrid[latKey][lonKey] = [];

        // 避免重复（相同ICAO且坐标相近）
        const exists = geofs.majorRunwayGrid[latKey][lonKey].some(r => r[0] === icao && Math.abs(r[4]-lat) < 0.001 && Math.abs(r[5]-lon) < 0.001);
        if (exists) return false;

        const runway = [icao, length, width, heading, lat, lon];
        if (elevation !== 0) runway.push(elevation);
        geofs.majorRunwayGrid[latKey][lonKey].push(runway);
        console.log(`✅ ${icao} (${lat}, ${lon})`);
        return true;
    }

    // 批量添加
    function addBatch(runwaysArray) {
        let success = 0;
        for (const r of runwaysArray) {
            if (addRunway(r[0], r[1], r[2], r[3], r[4], r[5], r[6] || 0)) success++;
        }
        console.log(`📊 成功添加 ${success} / ${runwaysArray.length} 条跑道`);
        return success;
    }

    // 从 JSON 数据解析并添加
    function parseAndAdd(data) {
        let runwaysArray = [];
        if (Array.isArray(data)) {
            if (data.length === 0) throw new Error('JSON 数组为空');
            if (Array.isArray(data[0])) {
                runwaysArray = data;
            } else if (typeof data[0] === 'object' && data[0].icao) {
                runwaysArray = data.map(item => [item.icao, item.length, item.width, item.heading, item.lat, item.lon, item.elevation || 0]);
            } else {
                throw new Error('不支持的 JSON 数组格式');
            }
        } else if (typeof data === 'object' && data.runways && Array.isArray(data.runways)) {
            const items = data.runways;
            if (items.length === 0) throw new Error('runways 数组为空');
            if (Array.isArray(items[0])) {
                runwaysArray = items;
            } else {
                runwaysArray = items.map(item => [item.icao, item.length, item.width, item.heading, item.lat, item.lon, item.elevation || 0]);
            }
        } else {
            throw new Error('无法解析 JSON 结构');
        }
        return addBatch(runwaysArray);
    }

    console.log(`🚀 开始从 ${RUNWAYS_JSON_URL} 加载跑道数据...`);
    try {
        const response = await fetch(RUNWAYS_JSON_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        const added = parseAndAdd(json);
        console.log(`🎉 加载完成！共添加 ${added} 条跑道。`);

        // 尝试刷新地图显示（缩放地图或移动飞机）
        if (typeof geofs !== 'undefined' && geofs.aircraft && geofs.aircraft.instance) {
            const pos = geofs.aircraft.instance.getPosition();
            geofs.aircraft.instance.setPosition({ lat: pos.lat + 0.001, lng: pos.lng, alt: pos.alt });
            setTimeout(() => geofs.aircraft.instance.setPosition(pos), 100);
            console.log('🔄 已轻微移动飞机以触发地图刷新');
        }
        if (typeof map !== 'undefined' && map.setView) {
            const center = map.getCenter();
            map.setView(center, map.getZoom() - 0.1);
            setTimeout(() => map.setView(center, map.getZoom() + 0.1), 50);
        }
    } catch (err) {
        console.error('❌ 加载失败:', err);
    }
})();

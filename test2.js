// GeoFS 跑道数据库管理插件（增强版：支持从 GitHub 加载 JSON）
(function() {
    if (typeof geofs === 'undefined' || !geofs.majorRunwayGrid) {
        console.error('错误: geofs.majorRunwayGrid 未找到，请确保在GeoFS游戏页面中运行此脚本');
        return;
    }

    const EARTH_RADIUS = 6371;

    function haversineDistance(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLon = (lon2 - lon1) * toRad;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
                  Math.sin(dLon / 2) ** 2;
        return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function getGridKey(coord) {
        let key = Math.trunc(coord);
        if (key === -0) key = 0;
        return String(key);
    }

    function findClosestRunwayGrid(lat, lon) {
        let minDist = Infinity;
        let targetLatKey = null;
        let targetLonKey = null;

        for (const [latKey, lonGrid] of Object.entries(geofs.majorRunwayGrid)) {
            for (const [lonKey, runways] of Object.entries(lonGrid)) {
                for (const runway of runways) {
                    const rLat = runway[4];
                    const rLon = runway[5];
                    if (rLat === undefined || rLon === undefined) continue;
                    const dist = haversineDistance(lat, lon, rLat, rLon);
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
        if (!icao || typeof icao !== 'string') {
            console.error('错误: ICAO代码必须为非空字符串');
            return false;
        }
        if (length <= 0 || width <= 0) {
            console.error('错误: 跑道长度和宽度必须为正数');
            return false;
        }

        let latKey = getGridKey(lat);
        let lonKey = getGridKey(lon);
        const targetGrid = findClosestRunwayGrid(lat, lon);
        if (targetGrid.latKey && targetGrid.lonKey) {
            latKey = targetGrid.latKey;
            lonKey = targetGrid.lonKey;
        }

        if (!geofs.majorRunwayGrid[latKey]) geofs.majorRunwayGrid[latKey] = {};
        if (!geofs.majorRunwayGrid[latKey][lonKey]) geofs.majorRunwayGrid[latKey][lonKey] = [];

        const existing = geofs.majorRunwayGrid[latKey][lonKey].find(r => r[0] === icao && Math.abs(r[4] - lat) < 0.001 && Math.abs(r[5] - lon) < 0.001);
        if (existing) {
            console.warn(`警告: 跑道 ${icao} 已存在，未添加`);
            return false;
        }

        const newRunway = [icao, length, width, heading, lat, lon];
        if (elevation !== 0) newRunway.push(elevation);
        geofs.majorRunwayGrid[latKey][lonKey].push(newRunway);
        console.log(`✅ 添加跑道: ${icao} (${lat}, ${lon}) → 网格 [${latKey}][${lonKey}]`);
        return true;
    }

    // 批量添加
    function addRunwaysBatch(runwaysArray) {
        let success = 0;
        for (const r of runwaysArray) {
            if (addRunway(r[0], r[1], r[2], r[3], r[4], r[5], r[6] || 0)) success++;
        }
        console.log(`批量添加完成: 成功 ${success} / ${runwaysArray.length}`);
        return success;
    }

    // 从 GitHub 原始 JSON 文件加载跑道数据
    async function loadFromGitHub(url, options = {}) {
        const { onProgress, append = true, clearExisting = false } = options;

        if (clearExisting) {
            console.log('清空现有跑道数据...');
            for (const latKey of Object.keys(geofs.majorRunwayGrid)) {
                delete geofs.majorRunwayGrid[latKey];
            }
        }

        console.log(`从 ${url} 加载跑道数据...`);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const data = await response.json();

            let runwaysArray = [];
            // 支持两种 JSON 格式：
            // 1. 直接数组: [ [icao, length, width, heading, lat, lon, elevation], ... ]
            // 2. 对象数组: [{ icao, length, width, heading, lat, lon, elevation }, ...]
            if (Array.isArray(data)) {
                if (data.length === 0) throw new Error('JSON 数组为空');
                if (Array.isArray(data[0])) {
                    // 格式1：嵌套数组
                    runwaysArray = data;
                } else if (typeof data[0] === 'object' && data[0].icao) {
                    // 格式2：对象数组
                    runwaysArray = data.map(item => [
                        item.icao, item.length, item.width, item.heading,
                        item.lat, item.lon, item.elevation || 0
                    ]);
                } else {
                    throw new Error('不支持的 JSON 数组格式');
                }
            } else if (typeof data === 'object' && data.runways && Array.isArray(data.runways)) {
                // 格式3：{ runways: [...] }
                const items = data.runways;
                if (items.length === 0) throw new Error('runways 数组为空');
                if (Array.isArray(items[0])) {
                    runwaysArray = items;
                } else {
                    runwaysArray = items.map(item => [
                        item.icao, item.length, item.width, item.heading,
                        item.lat, item.lon, item.elevation || 0
                    ]);
                }
            } else {
                throw new Error('无法解析 JSON 结构');
            }

            console.log(`解析到 ${runwaysArray.length} 条跑道数据，开始添加...`);
            const added = addRunwaysBatch(runwaysArray);
            if (onProgress) onProgress(added, runwaysArray.length);
            console.log(`🎉 加载完成！成功添加 ${added} 条跑道。`);
            return added;
        } catch (err) {
            console.error('加载失败:', err);
            throw err;
        }
    }

    // 删除跑道
    function removeRunway(icao, lat, lon) {
        for (const [latKey, lonGrid] of Object.entries(geofs.majorRunwayGrid)) {
            for (const [lonKey, runways] of Object.entries(lonGrid)) {
                const index = runways.findIndex(r => r[0] === icao && Math.abs(r[4] - lat) < 0.001 && Math.abs(r[5] - lon) < 0.001);
                if (index !== -1) {
                    const removed = runways.splice(index, 1)[0];
                    console.log(`🗑️ 删除跑道: ${removed[0]} (${removed[4]}, ${removed[5]})`);
                    if (runways.length === 0) {
                        delete geofs.majorRunwayGrid[latKey][lonKey];
                        if (Object.keys(geofs.majorRunwayGrid[latKey]).length === 0) {
                            delete geofs.majorRunwayGrid[latKey];
                        }
                    }
                    return true;
                }
            }
        }
        console.warn(`未找到匹配的跑道: ${icao} (${lat}, ${lon})`);
        return false;
    }

    function listRunways(limit = 50) {
        let count = 0;
        console.log('=== 跑道数据库列表 ===');
        for (const [latKey, lonGrid] of Object.entries(geofs.majorRunwayGrid)) {
            for (const [lonKey, runways] of Object.entries(lonGrid)) {
                for (const r of runways) {
                    console.log(`${r[0]} | 长度:${r[1]}ft | 宽度:${r[2]}ft | 航向:${r[3]}° | 坐标:(${r[4]}, ${r[5]})${r[6] ? ' | 海拔:'+r[6]+'ft' : ''}`);
                    if (++count >= limit) {
                        console.log(`... 共 ${count} 条记录（已达到显示限制 ${limit}）`);
                        return;
                    }
                }
            }
        }
        console.log(`总计 ${count} 条跑道记录`);
    }

    function findRunwayByICAO(icao) {
        const results = [];
        for (const [latKey, lonGrid] of Object.entries(geofs.majorRunwayGrid)) {
            for (const [lonKey, runways] of Object.entries(lonGrid)) {
                for (const r of runways) {
                    if (r[0].toUpperCase() === icao.toUpperCase()) {
                        results.push(r);
                    }
                }
            }
        }
        if (results.length === 0) {
            console.log(`未找到 ICAO 代码为 ${icao} 的跑道`);
        } else {
            console.log(`找到 ${results.length} 条匹配跑道:`);
            results.forEach(r => console.log(r));
        }
        return results;
    }

    window.geofsRunwayTool = {
        add: addRunway,
        addBatch: addRunwaysBatch,
        loadFromGitHub: loadFromGitHub,
        remove: removeRunway,
        list: listRunways,
        find: findRunwayByICAO,
        version: '1.1.0'
    };

    console.log('GeoFS 跑道管理插件已加载（支持从GitHub加载JSON）');
    console.log('使用方法: geofsRunwayTool.loadFromGitHub("https://raw.githubusercontent.com/你的用户名/仓库名/分支/文件.json")');
})();

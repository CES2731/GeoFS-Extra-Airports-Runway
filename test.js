(function() {
    'use strict';

    if (typeof geofs === 'undefined') {
        console.error('❌ GeoFS 未加载，请在 GeoFS 页面中运行此脚本。');
        return;
    }

    // ==================== 用户配置区域 ====================
    const CONFIG = {
        // 将下面的 URL 替换为您的 GitHub Raw JSON 文件链接
        GITHUB_RAW_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata.json'
    };
    // ====================================================

    /**
     * 添加自定义跑道（自动生成 RNW 物理跑道图标，若有频率则额外生成 ILS 导航台）
     */
    function addCustomRunway(options) {
        const icao = options.icao || 'CUST';
        const ident = options.ident || '00';
        const lat = parseFloat(options.lat);
        const lon = parseFloat(options.lon);
        const heading = parseFloat(options.heading);
        const lengthFt = options.lengthFt || 10000;
        const widthFt = options.widthFt || 150;
        const freq = options.freq || null;
        const slope = options.slope || 3.0;
        const major = options.major !== false;

        if (isNaN(lat) || isNaN(lon) || isNaN(heading)) {
            console.error(`❌ 跑道参数无效: ${icao} ${ident}`);
            return null;
        }

        // 构建完整的跑道对象（包含弹出窗口所需字段）
        const runwayFull = {
            icao: icao,
            ident: ident,
            name: `${icao} ${ident}`,        // 用于弹出窗口标题
            lat: lat,
            lon: lon,
            heading: heading,
            lengthFeet: lengthFt,
            widthFeet: widthFt,
            major: major,
            freq: freq,
            slope: slope
        };

        // 1. 添加物理跑道到导航系统（RNW类型，用于飞行计划搜索等）
        const runwayNavaid = Object.assign({}, runwayFull, { type: 'RNW', freq: null });
        const addedRunway = geofs.nav.addNavaid(runwayNavaid);
        console.log(`✅ 物理跑道已添加: ${icao} ${ident} (导航ID: ${addedRunway.id})`);

        // 2. 在地图上创建圆形标记（带弹出窗口）
        // 注意：addRunwayMarker 需要 runwayFull 对象，并且会读取 major 属性决定颜色
        if (geofs.map && typeof geofs.map.addRunwayMarker === 'function') {
            geofs.map.addRunwayMarker(runwayFull);
            console.log(`📍 地图标记已创建: ${icao} ${ident}`);
        } else {
            console.warn('⚠️ geofs.map.addRunwayMarker 不可用，跳过地图标记');
        }

        // 3. 如果有 ILS 频率，单独添加 ILS 导航台（ILS图标）
        if (freq) {
            const ilsObj = Object.assign({}, runwayFull, {
                type: 'ILS',
                ident: ident + 'X',          // 避免标识与跑道重复
                name: `${icao} ${ident} ILS`,
                freq: freq,
                slope: slope
            });
            const addedILS = geofs.nav.addNavaid(ilsObj);
            if (!geofs.nav.frequencies[freq]) {
                geofs.nav.frequencies[freq] = [];
            }
            geofs.nav.frequencies[freq].push(addedILS);
            console.log(`📡 ILS 导航台已添加: ${icao} ${ident} | 频率: ${(freq/1000).toFixed(2)} MHz`);
        }

        // 刷新地图图层，使新图标立即显示
        if (geofs.api.map && geofs.api.map.updateMarkerLayers) {
            geofs.api.map.updateMarkerLayers();
        }

        return addedRunway;
    }

    /**
     * 从 GitHub Raw URL 加载 JSON 数据并批量添加跑道
     */
    async function loadRunwaysFromGitHub(url) {
        console.log(`🚀 正在从 GitHub 加载跑道数据: ${url}`);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (!Array.isArray(data)) {
                console.error('❌ JSON 格式错误：应为数组');
                return;
            }

            let successCount = 0;
            data.forEach((item, index) => {
                try {
                    const result = addCustomRunway(item);
                    if (result) successCount++;
                } catch (e) {
                    console.warn(`⚠️ 第 ${index + 1} 条数据添加失败:`, e);
                }
            });

            console.log(`🎉 批量导入完成！成功添加 ${successCount}/${data.length} 条跑道`);
        } catch (error) {
            console.error('❌ 加载失败:', error.message);
        }
    }

    // 暴露全局方法（可选）
    window.addCustomRunway = addCustomRunway;
    window.loadRunwaysFromGitHub = loadRunwaysFromGitHub;

    // 自动执行加载
    if (CONFIG.GITHUB_RAW_URL && CONFIG.GITHUB_RAW_URL !== 'https://raw.githubusercontent.com/你的用户名/仓库名/分支/runways.json') {
        loadRunwaysFromGitHub(CONFIG.GITHUB_RAW_URL);
    } else {
        console.warn('⚠️ 请先在代码开头的 CONFIG 中填写您的 GitHub Raw URL！');
        console.log('示例: GITHUB_RAW_URL: \'https://raw.githubusercontent.com/用户名/仓库/main/runways.json\'');
    }
})();

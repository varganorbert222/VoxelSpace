const fs = require('fs');
const path = './MIS';

function strInsert(str, index, value) {
  return str.substr(0, index) + value + str.substr(index);
}

function normalizeStr(str) {
  if (str.search('_') === -1) {
    str = strInsert(str, str.length - 1, '_');
  }
  return str;
}

function processFileContent(content) {
  const upperContent = content.toUpperCase();

  let name = /;MISSION: .{4}/.exec(upperContent);
  if (name) {
    name = name[0].substring(10, 14);
  }
  let colorMap = /.{4}_C[.]PCX.*COLOR MAP/.exec(upperContent);
  if (colorMap) {
    colorMap = colorMap[0].substring(0, colorMap[0].search('.PCX'));
    colorMap = normalizeStr(colorMap);
  }
  let heightMap = /.{4}_D[.]PCX.*ELEVATION MAP/.exec(upperContent);
  if (heightMap) {
    heightMap = heightMap[0].substring(0, heightMap[0].search('.PCX'));
    heightMap = normalizeStr(heightMap);
  }
  let terrainHeight = /.*;TERRAIN SCALE/.exec(upperContent);
  if (terrainHeight) {
    terrainHeight = terrainHeight[0].substring(0, terrainHeight[0].search(';')).trim();
    terrainHeight = { 19: 192, 20: 384, 21: 768 }[terrainHeight] * 0.3048; // feet to meter
  }
  let terrainCamo = /.*;TERRAIN CAMMO/.exec(upperContent);
  if (terrainCamo) {
    terrainCamo = terrainCamo[0].substring(0, terrainCamo[0].search(';')).trim();
  }

  const skyColorPalette = {
    SNOW: ['#798EEC', '#E3E3E3', '#9AD3DE', '#718EBB', '#DAE1F1', '#728EAE', '#AFB8CE', '#3D5D82', '#D89374', '#BE89AF'],
    DESERT: ['#E4EDF2', '#CDE2EE', '#BBDCF0', '#A8DAF9', '#92D2F9', '#DAE1F1', '#728EAE', '#AFB8CE', '#3D5D82', '#D89374'],
    GREEN: ['#E4EDF2', '#CDE2EE', '#BBDCF0', '#A8DAF9', '#92D2F9', '#7ADBF0', '#FFA9F1', '#FFBE5C', '#FFE782', '#FCFDB5']
  };
  const palette = skyColorPalette[terrainCamo];
  const skyColor = palette[Math.floor(Math.random() * palette.length)];

  return {
    name: name,
    colorMap: colorMap,
    heightMap: heightMap,
    terrainCamo: terrainCamo,
    altitude: terrainHeight,
    skyColor: skyColor
  }
}

try {
  const files = fs.readdir(path, (error, files) => {
    if (error) {
      throw error;
    }

    const converted = [];
    for (const file of files) {
      const data = fs.readFileSync(`${path}/${file}`, 'utf8');
      const processed = processFileContent(data);
      converted.push(processed);
    }

    const json = JSON.stringify(converted);
    fs.writeFile('converted.json', json, (err) => {
      if (err) throw err;
      console.log('The file has been saved!');
    });
  });
} catch (error) {
  console.error(error);
} 
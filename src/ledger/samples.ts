// 演示用锁文件快照。v1 -> v2 内容演进可直观看到：
// 不变的包指纹不变（裁决保留）；版本/许可证变化的包指纹变化（旧裁决失效）。

export const sampleNpmV1 = {
  name: 'aurora-web',
  lockfileVersion: 3,
  packages: {
    '': { name: 'aurora-web', version: '2.4.0' },
    'node_modules/react': {
      version: '18.3.1',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz',
    },
    'node_modules/lodash': {
      version: '4.17.21',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
    },
    'node_modules/chart.js': {
      version: '4.4.4',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/chart.js/-/chart.js-4.4.4.tgz',
    },
    'node_modules/highlight.js': {
      version: '11.10.0',
      license: 'BSD-3-Clause',
      resolved: 'https://registry.npmjs.org/highlight.js/-/highlight.js-11.10.0.tgz',
    },
    'node_modules/legacy-parser': {
      version: '2.1.0',
      license: 'GPL-3.0',
      resolved: 'https://registry.npmjs.org/legacy-parser/-/legacy-parser-2.1.0.tgz',
    },
  },
};

export const sampleNpmV2 = {
  name: 'aurora-web',
  lockfileVersion: 3,
  packages: {
    '': { name: 'aurora-web', version: '2.5.0' },
    // react 指纹不变 -> 已批准结论照旧可用
    'node_modules/react': {
      version: '18.3.1',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz',
    },
    // lodash 升级 -> 新指纹 -> 旧裁决失效，回待复核
    'node_modules/lodash': {
      version: '4.18.0',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.18.0.tgz',
    },
    'node_modules/chart.js': {
      version: '4.4.4',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/chart.js/-/chart.js-4.4.4.tgz',
    },
    // highlight.js 许可证声明改变 -> 新指纹 -> 旧裁决失效
    'node_modules/highlight.js': {
      version: '11.10.0',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/highlight.js/-/highlight.js-11.10.0.tgz',
    },
    // legacy-parser 消失；新增 date-fns
    'node_modules/date-fns': {
      version: '3.6.0',
      license: 'MIT',
      resolved: 'https://registry.npmjs.org/date-fns/-/date-fns-3.6.0.tgz',
    },
  },
};

export const sampleComposer = {
  'content-hash': '3f5a91c8e2b47d6a0c1e5f8b2d9a4c7e',
  packages: [
    {
      name: 'monolog/monolog',
      version: 'v3.5.0',
      license: ['MIT'],
      dist: { url: 'https://repo.packagist.org/p/monolog/monolog.zip' },
    },
    {
      name: 'symfony/console',
      version: 'v6.4.10',
      license: ['MIT'],
      dist: { url: 'https://repo.packagist.org/p/symfony/console.zip' },
    },
    {
      name: 'twig/twig',
      version: 'v3.10.3',
      license: ['BSD-3-Clause'],
      dist: { url: 'https://repo.packagist.org/p/twig/twig.zip' },
    },
  ],
  'packages-dev': [
    {
      name: 'phpunit/phpunit',
      version: '10.5.30',
      license: ['BSD-3-Clause'],
      dist: { url: 'https://repo.packagist.org/p/phpunit/phpunit.zip' },
    },
  ],
};

export const sampleBroken =
  '{\n  "name": "aurora-web",\n  "lockfileVersion": 3,\n  "packages": {\n    "node_modules/react": {\n      "version": "18.3.1"\n      // 少了逗号，发布负责人手工合并时常见的破损\n';

export const lockSample = (kind: 'v1' | 'v2' | 'composer' | 'broken') =>
  kind === 'broken'
    ? sampleBroken
    : JSON.stringify(
        kind === 'v1' ? sampleNpmV1 : kind === 'v2' ? sampleNpmV2 : sampleComposer,
        null,
        2,
      );

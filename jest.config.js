module.exports = {
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jestHelpers/setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jestHelpers/setupFilesAfterEnv.js'],
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'styl'],
  moduleNameMapper: {
    '.(png|gif|jpe?g)$': '<rootDir>/jestHelpers/mocks/fileMock.js',
    '.svg$': '<rootDir>/jestHelpers/mocks/iconMock.js',
    '.styl$': 'identity-obj-proxy',
    '\\.(css|less)$': 'identity-obj-proxy',
    '^drive/locales/.*': '<rootDir>/src/drive/locales/en.json',
    '^photos/locales/.*': '<rootDir>/src/photos/locales/en.json',
    '^drive/(.*)': '<rootDir>/src/drive/$1',
    '^models(.*)': '<rootDir>/src/models$1',
    '^photos/(.*)': '<rootDir>/src/photos/$1',
    '^sharing(.*)': '<rootDir>/src/sharing$1',
    '^authentication(.*)': '<rootDir>/src/authentication$1',
    '^viewer(.*)': '<rootDir>/src/viewer$1',
    '^react-cozy-helpers(.*)': '<rootDir>/src/lib/react-cozy-helpers$1',
    '^components(.*)': '<rootDir>/src/components$1',
    '^hooks(.*)': '<rootDir>/src/hooks$1',
    '^test(.*)': '<rootDir>/test/$1',
    '^folder-references(.*)': '<rootDir>/src/folder-references$1',
    '^lib(.*)': '<rootDir>/src/lib$1',
    'react-pdf/dist/esm/pdf.worker.entry':
      '<rootDir>/jestHelpers/mocks/pdfjsWorkerMock.js',
    '^cozy-client$': 'cozy-client/dist/index.js',
    '^react-redux': '<rootDir>/node_modules/react-redux',
    '^cozy-ui/react(.*)$': '<rootDir>/node_modules/cozy-ui/transpiled/react$1'
  },
  clearMocks: true,
  snapshotSerializers: ['enzyme-to-json/serializer'],
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
    '^.+\\.webapp$': '<rootDir>/test/jestLib/json-transformer.js'
  },
  transformIgnorePatterns: ['node_modules/(?!cozy-ui)/'],
  testEnvironment: 'jest-environment-jsdom-sixteen',
  testMatch: ['**/(*.)(spec|test).js?(x)'],
  globals: {
    __APP_SLUG__: 'drive',
    __TARGET__: 'browser',
    __DEVELOPMENT__: true
  },
  reporters: ['default', '<rootDir>/jestHelpers/ConsoleUsageReporter.js']
}

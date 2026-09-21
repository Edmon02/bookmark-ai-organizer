module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};

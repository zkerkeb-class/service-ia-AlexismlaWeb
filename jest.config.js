module.exports = {
  testEnvironment: "node",
  collectCoverage: true,
  coverageReporters: ["text", "lcov"],
  testMatch: ["**/tests/**/*.spec.js", "**/tests/**/*.test.js"],
  coverageDirectory: "coverage"
};

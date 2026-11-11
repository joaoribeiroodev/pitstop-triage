module.exports = function (config) {
  config.set({
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher'), require('karma-coverage'), require('@angular-devkit/build-angular/plugins/karma')],
    reporters: ['progress'],
    // Meta da especificação (seção 15): 50% de linhas no frontend. Vale quando roda com --code-coverage.
    coverageReporter: {
      dir: require('node:path').join(__dirname, 'coverage/web'),
      subdir: '.',
      reporters: [{ type: 'text-summary' }, { type: 'lcovonly' }],
      check: { global: { lines: 50 } }
    },
    browsers: ['ChromeHeadlessCI'],
    customLaunchers: {
      ChromeHeadlessCI: { base: 'ChromeHeadless', flags: ['--no-sandbox', '--disable-gpu'] }
    },
    restartOnFileChange: false
  });
};

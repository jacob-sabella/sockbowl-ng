// Karma configuration
// Custom config: the default Angular karma config loads
// karma-jasmine-html-reporter (the "kjhtml" reporter), which uses the
// `jasmine.QueryString` API that was removed in jasmine-core 6. We drop that
// reporter here and use the plain "progress" reporter instead.
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/sockbowl-ng'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress'],
    browsers: ['Chrome'],
    // Headless, sandbox-free launcher for CI containers.
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu'],
      },
    },
    restartOnFileChange: true,
  });
};

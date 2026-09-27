// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // A leading underscore marks a parameter as intentionally unused (e.g.
      // CanActivate's (route, state) signature when a guard ignores both).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // --- Grandfathered on introducing angular-eslint (M1 upgrade pass) ---
      // These three would each be a real, repo-wide structural refactor
      // (NgModule -> standalone components/pipes/directives; constructor DI
      // -> inject(); default -> OnPush change detection, which the Angular 22
      // upgrade's ChangeDetectionStrategy.Eager migration just pinned
      // everywhere specifically to KEEP pre-v22 CD behavior). Downgraded to
      // warn (not off) so they stay visible without failing `npm run lint`;
      // tracked as a dependency-upgrade-milestone follow-up, not silenced.
      "@angular-eslint/prefer-standalone": "warn",
      "@angular-eslint/prefer-on-push-component-change-detection": "warn",
      // 74 pre-existing call sites across the app (event payloads, dialog
      // data, generic API response shapes). Properly typing each is a type
      // -safety pass in its own right, not a dependency upgrade; grandfathered
      // as warn rather than fixed blind to avoid guessing wrong shapes.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {},
  }
]);

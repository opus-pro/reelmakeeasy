# ESLint Rules Workspace

It leverages utilities from @typescript-eslint to allow TypeScript to
provide auto-completions etc for the configuration.

Your rule's custom logic will live within the create() method below
and you can learn more about writing ESLint rules on the official guide:

<https://eslint.org/docs/developer-guide/working-with-rules>

You can also view many examples of existing rules here:

<https://github.com/typescript-eslint/typescript-eslint/tree/master/packages/eslint-plugin/src/rules>

## How to create a new rule

Please copy any of the existing rule from `rules`. We suggest that your rule file return code like below

```ts
const yourNewRule: NxEslintRule = { RULE_NAME, rule }
export default yourNewRule
```

You need to define a `RULE_NAME` string and `rule` function.

## How to enable the rule after creation

Rules are created as a single ts file in `./rules` folder. And you need to import it in `index.ts` like:

```ts
import yourNewRule from './rules/your-new-rule'

// suppose that your RULE_NAME = 'your-new-rule'
module.exports = registerRules([
  // ...
  yourNewRule, // add it here
])
```

And also add the scope you want this rule to apply in the global `eslint.config.js` at the project root.

```js
export default tsEslint.config(
  // ...some other rules
  {
    files: ['libs/shared/common/**/*.ts'], // allow-list of what files you want to apply it
    // the rule name is starts with "@nx/workspace-", it will auto concat the `RULE_NAME` you define
    rules: { '@nx/workspace-your-new-rule': 'error' },
  },
)
```

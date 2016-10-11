'use strict';

const debug = require('debug')('divvy');
const fs = require('fs');
const ini = require('ini');

/**
 * In support of globbing, we turn the operation value into
 * a regex. We don't want to support full regex keys (we may
 * in the future, however that will be an explicit decision).
 * These characters are escaped from globbed keys before being
 * parsed into a regex ensuring that we only support globs.
 * The tl;dr of it is that it represents special regex chars
 * excluding "*".
 */
const REGEX_ESCAPE_CHARACTERS = /[-[\]{}()+?.,\\^$|#]/g;

function isGlobValue(v) {
  return v.endsWith('*');
}

class Config {

  constructor() {
    this.rules = [];
  }

  /**
   * Takes a glob rule value (e.g. /my/path/*) and creates a regex to
   * test the incoming operation value with.
   * @param {string} ruleValue The glob rule value to parse to regex.
   * @return {RegExp} The regex to test the operation value with.
   */
  static parseGlob(ruleValue) {
    ruleValue = ruleValue.replace(REGEX_ESCAPE_CHARACTERS, '\\$&');
    ruleValue = ruleValue.replace('*', '.*');
    return new RegExp(`^${ruleValue}`);
  }

  /** Creates a new instance from an `ini` file.  */
  static fromIniFile(filename) {
    // TODO(mikey): Tests.

    const rawConfig = ini.parse(fs.readFileSync(filename, 'utf-8'));
    const config = new Config();

    for (let rulegroupString of Object.keys(rawConfig)) {
      let rulegroupConfig = rawConfig[rulegroupString];

      let operation = Config.stringToOperation(rulegroupString);
      let creditLimit = parseInt(rulegroupConfig.creditLimit) || 0;
      let resetSeconds = parseInt(rulegroupConfig.resetSeconds) || 0;
      let actorField = rulegroupConfig.actorField || '';
      let comment = rulegroupConfig.comment;

      config.addRule(operation, creditLimit, resetSeconds, actorField, comment);
    }

    return config;
  }

  /** Converts a string like `a=b c=d` to an operation like `{a: 'b', c: 'd'}`. */
  static stringToOperation(s) {
    const operation = {};
    if (s === 'default') {
      return operation;
    }
    for (let kv of s.split(/\s+/)) {
      let pair = kv.split('=');
      operation[pair[0]] = pair[1] || '';
    }
    return operation;
  }

  /**
   * Installs a new rule with least significant precendence (append).
   *
   * @param {Object} operation    The "operation" to be rate limited, specifically,
   *                              a map of free-form key-value pairs.
   * @param {number} creditLimit  Number of operations to permit every `resetSeconds`
   * @param {number} resetSeconds Credit renewal interval.
   * @param {string} actorField   Name of the actor field (optional).
   * @param {string} comment      Optional diagnostic name for this rule.
   */
  addRule(operation, creditLimit, resetSeconds, actorField, comment) {
    const foundRule = this.findRule(operation);
    if (foundRule !== null) {
      throw new Error(
        `Unreachable rule for operation=${operation}; masked by operation=${foundRule.operation}`);
    }

    const rule = {
      operation: operation,
      creditLimit: creditLimit,
      resetSeconds: resetSeconds,
      actorField: actorField,
      comment: comment || null
    };
    this.rules.push(rule);

    debug('config: installed rule: %j', rule);
  }

  /** Returns the rule matching operation, or `null` if no match. */
  findRule(operation) {
    for (let rule of this.rules) {

      let match = true;
      for (let operationKey of Object.keys(rule.operation)) {
        let operationValue = rule.operation[operationKey];
        if (operationValue === '*') {
          // Wildcard value is a match
          continue;
        } else if (isGlobValue(operationValue)) {
          match = Config.parseGlob(operationValue).test(operation[operationKey]);
          break;
        } else if (operationValue !== operation[operationKey]) {
          match = false;
          break;
        }
      }

      if (match) {
        return rule;
      }
    }

    return null;
  }
}

module.exports = Config;
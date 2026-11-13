/** Flecten settings take precedence; existing Liquid launchers keep working. */
exports.productEnv = function productEnv(suffix, environment = process.env) {
  return environment[`FLECTEN_${suffix}`] ?? environment[`LIQUID_${suffix}`];
};

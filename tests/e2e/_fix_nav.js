const fs = require('fs');

function fix(fpath) {
  if (!fs.existsSync(fpath)) return;
  let c = fs.readFileSync(fpath, 'utf8');
  const orig = c;
  c = c.replaceAll("page.getByRole('button', { name: 'Continue' }).click()", "page.locator('.step[data-step-target=\"artwork\"]').click()");
  c = c.replaceAll("page.getByRole('button', { name: 'Continue', exact: true }).click()", "page.locator('.step[data-step-target=\"artwork\"]').click()");
  c = c.replaceAll("page.getByRole('button', { name: 'Preview', exact: true }).click()", "page.locator('.step[data-step-target=\"preview\"]').click()");
  c = c.replaceAll("page.getByRole('button', { name: 'Back to edit' }).click()", "page.locator('.step[data-step-target=\"artwork\"]').click()");
  c = c.replaceAll("page.getByRole('button', { name: 'Back to edit', exact: true }).click()", "page.locator('.step[data-step-target=\"artwork\"]').click()");
  c = c.replaceAll("page.getByRole('button', { name: 'Back to Preview', exact: true }).click()", "page.locator('.step[data-step-target=\"preview\"]').click()");
  if (c !== orig) fs.writeFileSync(fpath, c);
}

fix('tests/e2e/app.spec.js');
fix('tests/e2e/preview3d.spec.js');
fix('tests/e2e/pdf-layers.spec.js');
fix('tests/e2e/render.spec.js');
fix('tests/e2e/artwork-crop.spec.js');
console.log('done');

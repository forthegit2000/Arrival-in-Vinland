/** Enter a campaign through the real startup controls before gameplay tests. */
async function startDefaultCampaign(page, { arrival = false } = {}) {
  await page.locator('#title-screen [data-action="scenario"]').click();
  await page.locator('#modal-content [data-action="start-campaign"]').click();
  await page.waitForFunction(
    () => !Vinland.app.atTitleScreen && !document.querySelector('#game').inert,
  );
  if (!arrival) {
    // Existing gameplay regressions exercise an established camp. The dedicated
    // arrival suite keeps the real new-campaign opening instead.
    await page.evaluate(() => {
      const configuration = { ...Vinland.simulation.state.config };
      Vinland.replaceSimulation(new VinlandModel.Simulation(configuration));
      Vinland.setPaused(true);
    });
  }
}
async function loadSavedCampaign(page, slot = 'current') {
  await page.locator('#title-screen [data-action="load-game"]').click();
  await page.locator('#modal-content [data-action="load-slot"][data-slot="' + slot + '"]').click();
  await page.waitForFunction(() => !Vinland.app.atTitleScreen);
}
module.exports = { startDefaultCampaign, loadSavedCampaign };

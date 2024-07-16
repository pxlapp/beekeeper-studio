export default {
  name: "20240618_user_settings_pxl",
  async run(runner) {
    await runner.query(`
      INSERT INTO user_setting (key, defaultValue, valueType)
      VALUES
        ('pxlApiUrl', 'https://api.pxlapp.com', 0),
        ('pxlAccessToken', '', 0)
    `);
  }
}

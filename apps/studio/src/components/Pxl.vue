<template>
  <div id="pxl">
    <a
      href=""
      @click.prevent="authRequired === true ? authenticate() : openPxl()"
    >
      <img src="@/assets/images/pxl.svg" width="20">
      <div
        class="traffic-light"
        :class="{
          red: authRequired === true,
          green: authRequired === false,
        }"
      />
    </a>

    <portal to="modals">
      <modal
        class="vue-dialog beekeeper-modal pxl-auth-modal"
        name="pxl-auth-modal"
        height="auto"
        :scrollable="true"
        v-if="authRequired === true"
      >
        <div class="dialog-content">
          <h3 class="dialog-c-title">
            Sign into PXL
          </h3>
          <div class="instruction">
            Please click <a :href="verificationUrl" @click.prevent="openVerification">here</a> to authenticate this app with PXL using the code below.
          </div>
          <div class="code">
            {{ userCode }}
          </div>
        </div>
      </modal>
    </portal>
  </div>
</template>

<script>
import axios from 'axios';
import { shell } from 'electron';
import { mapGetters } from 'vuex'

const CLIENT_ID = 'WxdPp5OGJPsjcs0I7e5lDQ==';

export default {
  data() {
    return {
      authRequired: null,
      deviceCode: null,
      userCode: null,
      verificationUrl: null,
      to: null,
    };
  },
  computed: {
    ...mapGetters({
      'pxlApiUrl': 'settings/pxlApiUrl',
      'pxlAccessToken': 'settings/pxlAccessToken'
    }),
  },
  async mounted() {
    if (this.pxlAccessToken) {
      const url = new URL(this.pxlApiUrl);
      url.pathname = '/v1/auth/me';
      const resp = await axios.get(
        url.toString(),
        {headers: {Authorization: `Bearer ${this.pxlAccessToken}`}}
      );
      this.$set(this, 'authRequired', false);
      this.$store.commit('updatePxlReady', true);
      return;
    }
    this.$set(this, 'authRequired', true);
  },
  beforeUnmount() {
    if (this.to !== null) {
      clearTimeout(this.to.t);
    }
  },
  methods: {
    async authenticate() {
      const url = new URL(this.pxlApiUrl);
      url.pathname = '/v1/oauth/device/code';
      const resp = await axios.post(
        url.toString(),
        {client_id: CLIENT_ID},
        {headers: {'content-type': 'application/x-www-form-urlencoded'}}
      );
      const {data: {device_code: deviceCode, user_code: userCode, verification_uri: verificationUrl}} = resp;
      this.$set(this, 'verificationUrl', verificationUrl);
      this.$set(this, 'userCode', userCode);
      this.$set(this, 'deviceCode', deviceCode);
      this.$modal.show('pxl-auth-modal');
      this.$set(this, 'to', {count: 0, t: setTimeout(this.oauthCheck.bind(this), 30000)});
    },
    async oauthCheck() {
      const {count} = this.to;
      if (count > 10) {
        this.$set(this, 'to', null);
        return;
      }

      try {
        const url = new URL(this.pxlApiUrl);
        url.pathname = '/v1/oauth/access_token';
        const resp = await axios.post(
          url.toString(),
          {
            client_id: CLIENT_ID,
            device_code: this.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          },
          {headers: {'content-type': 'application/x-www-form-urlencoded'}}
        );
        const {data: {access_token: accessToken}} = resp;
        console.log(accessToken);
        this.$store.dispatch(
          'settings/save',
          { key: 'pxlAccessToken', value: accessToken }
        );
        this.$set(this, 'authRequired', false);
        this.$modal.hide('pxl-auth-modal');
        return;
      } catch (err) {
        console.error(err);
      }

      this.$set(this, 'to', {count: count + 1, t: setTimeout(this.oauthCheck.bind(this), 30000)});
    },
    openPxl() {
      shell.openExternal('https://pxlapp.com');
    },
    openVerification() {
      shell.openExternal(this.verificationUrl);
    }
  }
};
</script>

import * as msal from '@azure/msal-node';
import axios, { AxiosResponse } from 'axios';
import { wait } from '@shared/lib/wait';
import rawLog from 'electron-log';
import { TokenCache } from '@/common/appdb/models/token_cache';
import globals from '@/common/globals';

const log = rawLog.scope('auth/azure');

export enum AzureAuthType {
  Default, // This actually may not work at all, might need to just give up on it
  Password,
  AccessToken,
  MSIVM,
  ServicePrincipalSecret
}

// supported auth types that actually work :roll_eyes: default i'm looking at you
export const AzureAuthTypes = [
  // Can't have 2FA, kinda redundant now
  // { name: 'Password', value: AzureAuthType.Password },
  { name: 'Azure AD SSO', value: AzureAuthType.AccessToken },
  // This may be reactivated when we move to client server architecture
  // { name: 'MSI VM', value: AzureAuthType.MSIVM },
  { name: 'Azure Service Principal Secret', value: AzureAuthType.ServicePrincipalSecret }
];

type CloudTokenResponse = {
  cloud_token: CloudToken,
  errors: [],
  status: number,
  success: boolean
}

type Response = AxiosResponse<CloudTokenResponse, any>;

export interface CloudToken { 
  id: string,
  created_at: string,
  updated_at: string,
  params: string,
  status: string,
  url: string,
  fulfillment_url: string
}

export interface AuthConfig {
  type: string,
  options: {
    clientId?: string,
    token?: string,
    password?: string,
    userName?: string,
    tenantId?: string,
    msiEndpoint?: string,
    clientSecret?: string
  }
}

export interface AuthOptions {
  password?: string,
  userName?: string,
  tenantId?: string,
  msiEndpoint?: string,
  clientSecret?: string
}

let localCache: TokenCache;

const cachePlugin = {
  beforeCacheAccess: async (cacheContext: msal.TokenCacheContext): Promise<void> => {
    cacheContext.tokenCache.deserialize(localCache.cache)
  },
  afterCacheAccess: async (cacheContext: msal.TokenCacheContext): Promise<void> => {
    if (cacheContext.cacheHasChanged) {
      localCache.cache = cacheContext.tokenCache.serialize();
      localCache.save();
    }
  }
}

export class AzureAuthService {
  private pca: msal.PublicClientApplication;
  private start: number = null;

  private cancelFulfillment = false;

  public async init(authId: number) {
    if (!authId) {
      throw new Error("No TokenCache entry found in database");
    }

    localCache = await TokenCache.findOne(authId);

    const clientConfig = {
     auth: {
       clientId: globals.clientId
     },
     cache: {
       cachePlugin
     }
    };

    log.debug('Creating PCA');
    this.pca = new msal.PublicClientApplication(clientConfig);
  }

  public async auth(authType: AzureAuthType, options: AuthOptions): Promise<AuthConfig> {
    switch (authType) {
      case AzureAuthType.AccessToken:
        return await this.accessToken();
      case AzureAuthType.Password:
        return this.password(options);
      case AzureAuthType.MSIVM:
        return this.msiVM(options);
      case AzureAuthType.ServicePrincipalSecret:
        return this.servicePrincipal(options);
      case AzureAuthType.Default:
      default:
        return this.default();
    }
  }

  private servicePrincipal(options: AuthOptions): AuthConfig {
    return {
      type: 'azure-active-directory-service-principal-secret',
      options: {
        clientId: globals.clientId,
        clientSecret: options.clientSecret,
        tenantId: options.tenantId
      }
    }
  }

  private msiVM(options: AuthOptions): AuthConfig {
    return {
      type: 'azure-active-directory-msi-vm',
      options: {
        clientId: globals.clientId,
        msiEndpoint: options.msiEndpoint
      }
    }
  }

  private password(options: AuthOptions): AuthConfig {
    return {
      type: 'azure-active-directory-password',
      options: {
        userName: options.userName,
        password: options.password,
        clientId: globals.clientId,
        tenantId: options.tenantId
      }
    }
  }

  private default(): AuthConfig {
    return {
      type: 'azure-active-directory-default',
      options: {
        clientId: globals.clientId
      }
    }
  }

  private async accessToken(): Promise<AuthConfig> {
    const refreshToken = await this.tryRefresh();
    if (refreshToken) {
      return refreshToken;
    }
    log.debug('Getting beekeeper cloud token');
    const res = await axios.post('https://app.beekeeperstudio.io/api/cloud_tokens') as Response;

    const beekeeperCloudToken = res.data?.cloud_token;
    const authCodeUrlParams = {
      scopes: ['https://database.windows.net/.default', 'offline_access'],
      redirectUri: beekeeperCloudToken.fulfillment_url,
      state: beekeeperCloudToken.id,
      prompt: 'consent'
    };
    const authUrl = await this.pca.getAuthCodeUrl(authCodeUrlParams);

    log.debug('Getting auth code')
    window.location.href = authUrl;

    this.start = Date.now();
    const result = await this.checkStatus(beekeeperCloudToken.url);
    if (!result || result?.data?.cloud_token?.status !== 'fulfilled') {
      throw new Error(`Looks like you didn't sign in on your browser. Please try again.`);
    }
    await axios.put(beekeeperCloudToken.url, { status: 'claimed' });

    const params = result.data.cloud_token.params;
    const code = params['code'];

    if (code) {
      const tokenRequest = {
        code: code,
        scopes: ['https://database.windows.net/.default', 'offline_access'],
        redirectUri: beekeeperCloudToken.fulfillment_url,
        state: beekeeperCloudToken.id
      };

      const tokenResponse = await this.pca.acquireTokenByCode(tokenRequest)

      localCache.homeId = tokenResponse.account.homeAccountId;
      localCache.save();
      return {
        type: 'azure-active-directory-access-token',
        options: {
          token: tokenResponse.accessToken,
        }
      };
    }
  }

  public cancel(): void {
    this.cancelFulfillment = true;
  }

  private async tryRefresh(): Promise<AuthConfig | null> {
    const tokenCache = this.pca.getTokenCache();
    const account = await tokenCache.getAccountByHomeId(localCache.homeId);

    if (!account) {
      return null;
    }

    let refreshTokenResponse: msal.AuthenticationResult;

    try {
      refreshTokenResponse = await this.pca.acquireTokenSilent({
        account: account,
        scopes: ['https://database.windows.net/.default', 'offline_access'],
        forceRefresh: true
      });
    } catch {
      log.info('refresh failed');
      return null;
    }

    if (refreshTokenResponse) {
      return {
        type: 'azure-active-directory-access-token',
        options: {
          token: refreshTokenResponse.accessToken,
        }
      }
    }

    return null;
  }
  
  private async checkStatus(url: string): Promise<Response> {
    const timedOut = Date.now() - this.start >= globals.pollingTimeout;
    if (this.cancelFulfillment || timedOut) {
      return null;
    }
    const result = await axios.get(url) as Response;
    if (result?.data?.cloud_token?.status !== 'fulfilled') {
      await wait(2000);
      return await this.checkStatus(url);
    } else {
      return result;
    }
  }
}

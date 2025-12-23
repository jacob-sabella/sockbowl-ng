import { Injectable, Inject, Optional } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { OAuthService } from 'angular-oauth2-oidc';
import { environment } from '../../../environments/environment';

/**
 * HTTP Interceptor that adds JWT access token to outgoing requests.
 *
 * Automatically adds Authorization header with Bearer token
 * for authenticated users when auth is enabled.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {

  constructor(@Optional() private oauthService: OAuthService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Only add token if auth is enabled
    if (!environment.authEnabled || !this.oauthService) {
      return next.handle(request);
    }

    const accessToken = this.oauthService.getAccessToken();

    if (accessToken) {
      // Clone request and add Authorization header
      request = request.clone({
        setHeaders: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    }

    return next.handle(request);
  }
}

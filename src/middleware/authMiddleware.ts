import { auth } from 'express-oauth2-jwt-bearer';
import config from '../config';

/**
 * Middleware to validate Access Tokens (JWTs) issued by Auth0.
 * It checks for the correct issuer and audience.
 */
export const checkJwt = auth({
    issuerBaseURL: `https://${config.AUTH0_DOMAIN}`,
    audience: config.AUTH0_AUDIENCE,
    tokenSigningAlg: 'RS256'
});

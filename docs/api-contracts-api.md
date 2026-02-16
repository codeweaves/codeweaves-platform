# API Contracts - API Backend

> Generated: 2026-02-14 | Part: api | Scan Level: Quick

## Base URL

- **Development**: `http://localhost:3001`
- **Production**: Configured via environment

## Authentication

All endpoints under `/auth/` require a valid Auth0 JWT token:

```
Authorization: Bearer <auth0_jwt_token>
```

Endpoints marked as `@Public()` are accessible without authentication.

## Endpoints

### Health Check

```
GET /health
```

**Auth:** Public (no authentication required)
**Controller:** `HealthController`
**Description:** Returns API health status

**Response:**
```json
{
  "status": "ok"
}
```

---

### Get Current User

```
GET /users/me
```

**Auth:** JWT Required
**Controller:** `UsersController`
**Description:** Returns the authenticated user's profile. If the user doesn't exist in the local database, the `UserSyncInterceptor` automatically creates them from Auth0 profile data.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "CLIENT",
  "auth0Id": "auth0|123456",
  "organizationId": "uuid",
  "createdAt": "2026-02-14T00:00:00.000Z",
  "updatedAt": "2026-02-14T00:00:00.000Z"
}
```

---

### Update Current User

```
PATCH /users/me
```

**Auth:** JWT Required
**Controller:** `UsersController`
**Description:** Updates the authenticated user's profile

**Request Body:**
```json
{
  "name": "Updated Name"
}
```

**Response:** Updated user object (same schema as GET /users/me)

---

## Error Responses

| Status | Description |
|--------|-------------|
| 401 | Unauthorized - Invalid or missing JWT token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 422 | Validation Error - Invalid request body |
| 500 | Internal Server Error |

## Auth0 Integration Notes

- JWT tokens are validated against Auth0 JWKS endpoint
- Token audience must match `AUTH0_AUDIENCE` env var
- Token issuer must match `https://{AUTH0_DOMAIN}/`
- The `UserSyncInterceptor` creates local user records on first authenticated request

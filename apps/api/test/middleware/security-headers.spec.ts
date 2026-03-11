import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Get } from '@nestjs/common';
import helmet from 'helmet';
import supertest from 'supertest';
import { getHelmetOptions } from '../../src/config/security-headers.config';

// Minimal controller for testing security headers
@Controller('test')
class TestController {
  @Get()
  getTest() {
    return { ok: true };
  }
}

describe('Security Headers Middleware', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createApp(nodeEnv?: string): Promise<INestApplication> {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestController],
    }).compile();

    const nestApp = module.createNestApplication();
    nestApp.use(helmet(getHelmetOptions(nodeEnv)));
    await nestApp.init();
    return nestApp;
  }

  describe('development environment', () => {
    beforeEach(async () => {
      app = await createApp('development');
    });

    it('should set X-Content-Type-Options: nosniff', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should set X-Frame-Options: DENY', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('should set X-XSS-Protection: 0', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['x-xss-protection']).toBe('0');
    });

    it('should set X-Permitted-Cross-Domain-Policies: none', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
    });

    it('should set Referrer-Policy: strict-origin-when-cross-origin', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    });

    it('should NOT include X-Powered-By header', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('should NOT set Strict-Transport-Security in development', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });

    it('should NOT set Content-Security-Policy in development (Swagger compatibility)', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['content-security-policy']).toBeUndefined();
    });
  });

  describe('production environment', () => {
    beforeEach(async () => {
      app = await createApp('production');
    });

    it('should set Strict-Transport-Security with max-age and includeSubDomains', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains',
      );
    });

    it('should set Content-Security-Policy with default-src none', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
    });

    it('should set all other security headers in production', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('NODE_ENV unset', () => {
    beforeEach(async () => {
      app = await createApp(undefined);
    });

    it('should NOT set Strict-Transport-Security when NODE_ENV is unset', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });

    it('should NOT set Content-Security-Policy when NODE_ENV is unset', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['content-security-policy']).toBeUndefined();
    });

    it('should still set base security headers when NODE_ENV is unset', async () => {
      const res = await supertest(app.getHttpServer()).get('/test');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('error responses', () => {
    beforeEach(async () => {
      app = await createApp('production');
    });

    it('should set security headers on 404 responses', async () => {
      const res = await supertest(app.getHttpServer()).get('/non-existent');
      expect(res.status).toBe(404);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});

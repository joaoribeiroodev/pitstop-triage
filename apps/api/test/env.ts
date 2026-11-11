const base = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/pitstop_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = base;
process.env.DATABASE_SSL = 'false';
process.env.AUTH_PROVIDER = 'local';
process.env.APP_JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.PORTAL_BASE_URL = 'https://app.pitstop.test';
process.env.THROTTLE_DISABLED = process.env.THROTTLE_DISABLED ?? 'true';
process.env.LOG_LEVEL = 'silent';

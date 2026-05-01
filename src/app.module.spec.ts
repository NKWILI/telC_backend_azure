import 'reflect-metadata';
import { AppModule } from './app.module';

describe('AppModule metadata', () => {
  it('should not register DatabaseService as a provider', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const providers: unknown[] =
      Reflect.getMetadata('providers', AppModule) ?? [];
    const names = (providers as { name?: string }[]).map((p) => p?.name);
    expect(names).not.toContain('DatabaseService');
  });
});

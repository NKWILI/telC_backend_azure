/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { LocationsController } from '../src/modules/locations/locations.controller';

/**
 * The dropdown data for onboarding and settings.
 *
 * Public and cacheable: it holds no personal data, every center needs it
 * before it can log a first write, and a controlled country list is what makes
 * "Douala / douala / Dla" impossible in reports.
 */
describe('LocationsController contract', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [LocationsController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the tree without a token, because the form is filled before login', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/locations')
      .expect(200);

    expect(Array.isArray(response.body.countries)).toBe(true);
    expect(
      response.body.countries.map((c: { code: string }) => c.code),
    ).toEqual(['CM', 'DE']);
  });

  it('carries each country address rules, so the wizard asks for the right fields', async () => {
    const response = await request(app.getHttpServer()).get('/api/locations');

    const cameroon = response.body.countries.find(
      (c: { code: string }) => c.code === 'CM',
    );
    expect(cameroon.addressRules).toEqual({
      district: 'required',
      postalCode: 'absent',
      street: 'optional',
      houseNumber: 'optional',
    });
  });

  it('groups cities under their region, which the client shows but never asks for', async () => {
    const response = await request(app.getHttpServer()).get('/api/locations');

    const cameroon = response.body.countries.find(
      (c: { code: string }) => c.code === 'CM',
    );
    const littoral = cameroon.regions.find(
      (r: { id: string }) => r.id === 'littoral',
    );

    expect(littoral.name).toBe('Littoral');
    expect(littoral.cities).toEqual(
      expect.arrayContaining([{ id: 'douala', name: 'Douala' }]),
    );
  });

  it('tells clients to keep it for a day: the list changes with a deploy, not per request', async () => {
    const response = await request(app.getHttpServer()).get('/api/locations');

    expect(response.headers['cache-control']).toContain('max-age=86400');
    expect(response.headers['cache-control']).toContain('public');
  });

  it('answers 304 to a client that already has this version', async () => {
    const first = await request(app.getHttpServer()).get('/api/locations');
    const etag = first.headers.etag;

    expect(etag).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/locations')
      .set('If-None-Match', etag)
      .expect(304);
  });
});

import { BadRequestException } from '@nestjs/common';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';
import { SupportContactDto } from '../src/modules/centers/dto/center-support.dto';

/**
 * The support form's rules (D24), through the same pipe production uses: a
 * message of at least 10 characters after trimming, a real email, a name.
 */
describe('SupportContactDto', () => {
  const pipe = createGlobalValidationPipe();
  const check = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: SupportContactDto });

  const valid = {
    name: 'Awa Mbarga',
    email: 'awa@school.cm',
    message: 'Our codes do not appear.',
  };

  /** The field names the refusal mentions. */
  const refusedFields = async (body: Record<string, unknown>) => {
    const error = (await check(body).catch((e: unknown) => e)) as
      | BadRequestException
      | undefined;
    expect(error).toBeInstanceOf(BadRequestException);
    const { message } = error!.getResponse() as { message: string[] };
    return message.map((line) => line.split(' ')[0]);
  };

  it('accepts a real message, trimmed, with the email normalised', async () => {
    const dto = (await check({
      name: '  Awa Mbarga  ',
      email: '  AWA@School.cm ',
      message: '  Our codes do not appear.  ',
    })) as SupportContactDto;

    expect(dto).toEqual({
      name: 'Awa Mbarga',
      email: 'awa@school.cm',
      message: 'Our codes do not appear.',
    });
  });

  it('counts the 10 characters after trimming, so spaces are not a message', async () => {
    expect(
      await refusedFields({ ...valid, message: '     short     ' }),
    ).toContain('message');
    expect(
      await refusedFields({ ...valid, message: ' '.repeat(20) }),
    ).toContain('message');
  });

  it('refuses a message of 5000 characters or more', async () => {
    expect(
      await refusedFields({ ...valid, message: 'x'.repeat(5001) }),
    ).toContain('message');
  });

  it('refuses an address that is not an email, and a missing name', async () => {
    expect(await refusedFields({ ...valid, email: 'not-an-email' })).toContain(
      'email',
    );
    expect(await refusedFields({ ...valid, name: '   ' })).toContain('name');
  });

  it('refuses fields the form does not have', async () => {
    expect(
      await refusedFields({ ...valid, centerId: 'another-center' }),
    ).toContain('property');
  });
});

import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../src/pipes/zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(2).max(100).optional(),
  });

  let pipe: ZodValidationPipe;

  beforeEach(() => {
    pipe = new ZodValidationPipe(schema);
  });

  it('should pass valid data through', () => {
    const result = pipe.transform({ name: 'John Doe' });
    expect(result).toEqual({ name: 'John Doe' });
  });

  it('should pass empty object through when all fields are optional', () => {
    const result = pipe.transform({});
    expect(result).toEqual({});
  });

  it('should strip unknown properties', () => {
    const result = pipe.transform({ name: 'John', email: 'should@be.stripped' });
    expect(result).toEqual({ name: 'John' });
  });

  it('should strip email field - email is managed by Auth0 (AC3)', () => {
    const result = pipe.transform({ name: 'Valid Name', email: 'hacker@evil.com' });
    expect(result).toEqual({ name: 'Valid Name' });
    expect(result).not.toHaveProperty('email');
  });

  it('should strip role field - role cannot be self-modified (AC4)', () => {
    const result = pipe.transform({ name: 'Valid Name', role: 'ADMIN' });
    expect(result).toEqual({ name: 'Valid Name' });
    expect(result).not.toHaveProperty('role');
  });

  it('should strip both email and role when sent together', () => {
    const result = pipe.transform({
      name: 'Valid Name',
      email: 'hacker@evil.com',
      role: 'SUPER_ADMIN',
    });
    expect(result).toEqual({ name: 'Valid Name' });
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('role');
  });

  it('should throw BadRequestException for invalid data', () => {
    expect(() => pipe.transform({ name: 'J' })).toThrow(BadRequestException);
  });

  it('should include field-level error details', () => {
    try {
      pipe.transform({ name: 'J' });
      fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();
      expect(response).toEqual(
        expect.objectContaining({
          message: 'Validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'name',
            }),
          ]),
        }),
      );
    }
  });

  it('should throw for non-string name', () => {
    expect(() => pipe.transform({ name: 123 })).toThrow(BadRequestException);
  });

  it('should throw for name exceeding max length', () => {
    expect(() => pipe.transform({ name: 'a'.repeat(101) })).toThrow(
      BadRequestException,
    );
  });
});

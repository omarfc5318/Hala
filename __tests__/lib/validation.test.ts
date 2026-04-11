import {
  loginSchema,
  usernameSchema,
  credentialsSchema,
  nameSchema,
  bioSchema,
  citySchema,
  eateryReviewSchema,
  eateryAddSchema,
  friendSearchSchema,
} from '../../lib/validation';

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------

describe('loginSchema', () => {
  it('accepts valid credentials', () => {
    expect(loginSchema.safeParse({ email: 'user@example.com', password: 'password123' }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ email: 'notanemail', password: 'password123' }).success).toBe(false);
  });

  it('rejects short password', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: 'short' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/8 characters/);
    }
  });
});

// ---------------------------------------------------------------------------
// usernameSchema
// ---------------------------------------------------------------------------

describe('usernameSchema', () => {
  it('accepts valid usernames', () => {
    expect(usernameSchema.safeParse('omar').success).toBe(true);
    expect(usernameSchema.safeParse('omar.farhan_99').success).toBe(true);
  });

  it('rejects too-short usernames', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
  });

  it('rejects too-long usernames', () => {
    expect(usernameSchema.safeParse('a'.repeat(31)).success).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(usernameSchema.safeParse('omar farhan').success).toBe(false);
    expect(usernameSchema.safeParse('omar@').success).toBe(false);
    expect(usernameSchema.safeParse('omar!').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// credentialsSchema
// ---------------------------------------------------------------------------

describe('credentialsSchema', () => {
  const base = { email: 'a@b.com', password: 'password1' };

  it('accepts without invite code', () => {
    expect(credentialsSchema.safeParse(base).success).toBe(true);
  });

  it('accepts with empty string invite code', () => {
    expect(credentialsSchema.safeParse({ ...base, inviteCode: '' }).success).toBe(true);
  });

  it('accepts with 12-char invite code', () => {
    expect(credentialsSchema.safeParse({ ...base, inviteCode: 'ABCDEF123456' }).success).toBe(true);
  });

  it('rejects invite code that is not 12 chars', () => {
    expect(credentialsSchema.safeParse({ ...base, inviteCode: 'SHORT' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nameSchema
// ---------------------------------------------------------------------------

describe('nameSchema', () => {
  it('accepts valid names', () => {
    expect(nameSchema.safeParse('Omar Farhan').success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(nameSchema.safeParse('').success).toBe(false);
  });

  it('rejects name longer than 80 chars', () => {
    expect(nameSchema.safeParse('a'.repeat(81)).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bioSchema
// ---------------------------------------------------------------------------

describe('bioSchema', () => {
  it('accepts undefined', () => {
    expect(bioSchema.safeParse(undefined).success).toBe(true);
  });

  it('accepts empty bio', () => {
    expect(bioSchema.safeParse('').success).toBe(true);
  });

  it('rejects bio > 160 chars', () => {
    expect(bioSchema.safeParse('a'.repeat(161)).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// citySchema
// ---------------------------------------------------------------------------

describe('citySchema', () => {
  it('accepts riyadh and dubai', () => {
    expect(citySchema.safeParse('riyadh').success).toBe(true);
    expect(citySchema.safeParse('dubai').success).toBe(true);
  });

  it('rejects other values', () => {
    expect(citySchema.safeParse('cairo').success).toBe(false);
    expect(citySchema.safeParse('').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eateryReviewSchema
// ---------------------------------------------------------------------------

describe('eateryReviewSchema', () => {
  it('accepts valid review', () => {
    expect(eateryReviewSchema.safeParse({ rank: 1, text: 'Great!', favourite_dish: 'Burger' }).success).toBe(true);
  });

  it('accepts review with optional fields omitted', () => {
    expect(eateryReviewSchema.safeParse({ rank: 3 }).success).toBe(true);
  });

  it('rejects rank out of range', () => {
    expect(eateryReviewSchema.safeParse({ rank: 0 }).success).toBe(false);
    expect(eateryReviewSchema.safeParse({ rank: 6 }).success).toBe(false);
  });

  it('rejects text longer than 500 chars', () => {
    expect(eateryReviewSchema.safeParse({ rank: 1, text: 'a'.repeat(501) }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eateryAddSchema
// ---------------------------------------------------------------------------

describe('eateryAddSchema', () => {
  const valid = {
    name: 'Burger Hub',
    location_text: 'Al Olaya, Riyadh',
    latitude: 24.7136,
    longitude: 46.6753,
    city: 'riyadh' as const,
  };

  it('accepts valid eatery', () => {
    expect(eateryAddSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts with optional website', () => {
    expect(eateryAddSchema.safeParse({ ...valid, website: 'https://burgerhub.com' }).success).toBe(true);
  });

  it('accepts with empty website (treated as optional)', () => {
    expect(eateryAddSchema.safeParse({ ...valid, website: '' }).success).toBe(true);
  });

  it('rejects invalid website URL', () => {
    expect(eateryAddSchema.safeParse({ ...valid, website: 'not-a-url' }).success).toBe(false);
  });

  it('rejects missing name', () => {
    const { name: _, ...rest } = valid;
    expect(eateryAddSchema.safeParse(rest).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// friendSearchSchema
// ---------------------------------------------------------------------------

describe('friendSearchSchema', () => {
  it('accepts query with 2+ chars', () => {
    expect(friendSearchSchema.safeParse({ query: 'om' }).success).toBe(true);
  });

  it('rejects single-char query', () => {
    expect(friendSearchSchema.safeParse({ query: 'o' }).success).toBe(false);
  });

  it('rejects query longer than 50 chars', () => {
    expect(friendSearchSchema.safeParse({ query: 'a'.repeat(51) }).success).toBe(false);
  });
});

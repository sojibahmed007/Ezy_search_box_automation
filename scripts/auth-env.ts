export function getCommunityCredentials() {
  const email = process.env.COMMUNITY_EMAIL;
  const password = process.env.COMMUNITY_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Set COMMUNITY_EMAIL and COMMUNITY_PASSWORD environment variables before logging in.',
    );
  }

  return { email, password };
}

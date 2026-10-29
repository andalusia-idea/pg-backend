export const envFilePath = (app: string): string[] => {
  const dir = `apps/${app}`;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'test') return [`${dir}/.env.test`];

  if (nodeEnv === 'development')
    return [`${dir}/.env.local`, `${dir}/.env.development`];

  if (nodeEnv === 'production')
    return [`${dir}/.env`, `${dir}/.env.production`];

  return [`${dir}/.env.${nodeEnv}`];
};

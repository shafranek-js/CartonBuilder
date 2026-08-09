export async function publishInteractiveHtml({
  blob,
  contentBase64,
  filename,
  token,
  owner,
  repo,
  branch = 'master',
  publishDir = 'public/exports',
  signal,
  fetchRef = globalThis.fetch,
  apiBaseUrl = 'https://api.github.com',
  siteBaseUrl = null,
} = {}) {
  if (!token) throw new Error('GitHub token is required.');
  if (!owner || !repo) throw new Error('GitHub repository (owner/repo) is required.');

  const content = contentBase64 || await blobToBase64(blob);
  const path = `${publishDir}/${filename}`;
  const response = await fetchRef(`${apiBaseUrl}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    signal,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Publish interactive export ${filename}`,
      content,
      branch,
    }),
  });

  if (!response.ok) {
    let message = `GitHub API error ${response.status}`;
    try {
      const data = await response.json();
      if (data?.message) message = `${data.message} (${response.status})`;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const pageBaseUrl = siteBaseUrl || `https://${owner}.github.io/${repo}`;
  const servedDir = publishDir.replace(/^public\//, '');
  const servedPath = `${servedDir}/${filename}`;
  return {
    pageUrl: `${pageBaseUrl}/${servedPath}`,
    uploaded: await response.json(),
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

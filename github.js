const GITHUB_TOKEN = 'YOUR_GITHUB_TOKEN_HERE';
const GITHUB_USERNAME = 'GITHUB_USERNAME';
const GITHUB_REPO = 'logi-dictionary';
const GITHUB_FILE_PATH = 'data/dictionary.json';
const GITHUB_BRANCH = 'main';

const API_BASE = 'https://api.github.com';

async function githubGet() {
  const url = `${API_BASE}/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  return { data: JSON.parse(content), sha: data.sha };
}

async function githubPut(dictionary, sha) {
  const url = `${API_BASE}/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(dictionary, null, 2))));
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Update dictionary — ${new Date().toISOString()}`,
      content,
      sha,
      branch: GITHUB_BRANCH
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub PUT failed: ${res.status} ${err.message}`);
  }
  return await res.json();
}

export { githubGet, githubPut };

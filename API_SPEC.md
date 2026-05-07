# Deal & Reel Agent API Specification

This document describes the API endpoints available for the Agent to Read, Write, Update, and Delete articles on the Deal & Reel website. The API acts as a secure proxy to GitHub, directly managing markdown files that trigger website deployments.

## Base Information
- **Base URL**: `https://dealandreel.com` (or `http://localhost:8787` for local testing)
- **Authentication**: All requests must include the `X-API-Key` header.
- **Rate Limit**: 10 requests per minute per IP.

## Endpoints

### 1. List Articles
**GET** `/api/articles`
Returns a list of all current articles.

- **Request**:
  ```http
  GET /api/articles
  X-API-Key: YOUR_API_KEY
  ```
- **Response** (200 OK):
  ```json
  {
    "count": 2,
    "articles": [
      {
        "slug": "flutter-sisal-buyout-europe",
        "filename": "flutter-sisal-buyout-europe.md",
        "size_bytes": 3856,
        "url": "https://dealandreel.com/articles/flutter-sisal-buyout-europe"
      }
    ]
  }
  ```

### 2. Read Article
**GET** `/api/articles/:slug`
Fetches the raw Markdown content of a specific article.

- **Request**:
  ```http
  GET /api/articles/flutter-sisal-buyout-europe
  X-API-Key: YOUR_API_KEY
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "slug": "flutter-sisal-buyout-europe",
    "content": "---\nid: EU-260501-01\ntitle: ...",
    "sha": "a1b2c3d4e5f6..."
  }
  ```

### 3. Create (Publish) Article
**POST** `/api/publish`
Creates a new article. If an article with the same slug already exists, this will return a 409 error (use PUT instead).

- **Request**:
  ```http
  POST /api/publish
  X-API-Key: YOUR_API_KEY
  Content-Type: application/json
  ```
  ```json
  {
    "slug": "my-new-article",
    "message": "Publishing my new article",
    "content": "---\nid: US-260508-01\ntitle: \"My New Article\"\ncategory: \"News\"\ndate: 2026-05-08\ntags: [\"test\", \"agent\"]\nslug: \"my-new-article\"\n---\n\nHere is the body of the article."
  }
  ```
  **Note on Frontmatter**: The `content` must include standard YAML frontmatter with the following **required fields**: `id`, `title`, `category`, `date`, `slug`, `tags`. 

- **Response** (201 Created):
  ```json
  {
    "success": true,
    "slug": "my-new-article",
    "url": "https://dealandreel.com/articles/my-new-article",
    "commit": "...",
    "deployed_in": "~60 seconds"
  }
  ```

### 4. Update Article
**PUT** `/api/publish`
Updates an existing article. 

- **Request**:
  ```http
  PUT /api/publish
  X-API-Key: YOUR_API_KEY
  Content-Type: application/json
  ```
  ```json
  {
    "slug": "my-new-article",
    "message": "Updating article text",
    "content": "---\nid: US-260508-01\n..."
  }
  ```
- **Response** (200 OK): Same format as Create.

### 5. Delete Article
**DELETE** `/api/articles/:slug`
Deletes the specified article.

- **Request**:
  ```http
  DELETE /api/articles/my-new-article
  X-API-Key: YOUR_API_KEY
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "slug": "my-new-article",
    "commit": "...",
    "deployed_in": "~60 seconds"
  }
  ```

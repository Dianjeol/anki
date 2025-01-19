const axios = require('axios');

exports.handler = async function(event, context) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse the incoming request body
    const payload = JSON.parse(event.body);

    // First request to get the download URL
    const response = await axios.post(
      'https://dianjeol.pythonanywhere.com/api/convert-direct',
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Check if we got a valid response with download URL
    if (!response.data?.download_url) {
      throw new Error('No download URL in response');
    }

    // Second request to get the actual file
    const fileResponse = await axios.get(response.data.download_url, {
      responseType: 'arraybuffer'
    });

    // Return the file with appropriate headers
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${payload.deck_name || 'Anki-Cards'}.apkg"`
      },
      body: Buffer.from(fileResponse.data).toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: error.response?.status || 500,
      body: JSON.stringify({
        error: error.response?.data?.error || error.message || 'Internal server error'
      })
    };
  }
}; 
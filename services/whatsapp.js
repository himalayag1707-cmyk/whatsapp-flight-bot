const axios = require('axios');

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.log("SEND ERROR:", err.response?.data || err.message);
  }
}

async function sendListMessage(to, headerText, bodyText, buttonLabel, sections) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          header: { type: "text", text: headerText },
          body: { text: bodyText },
          action: {
            button: buttonLabel,
            sections: sections
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.log("SEND LIST ERROR:", err.response?.data || err.message);
  }
}

async function sendImageMessage(to, imageUrl, caption) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link: imageUrl, caption: caption || "" }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.log("SEND IMAGE ERROR:", err.response?.data || err.message);
  }
}

async function downloadMedia(mediaId) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });
    if (!res.data || !res.data.url) return null;
    const mediaRes = await axios.get(res.data.url, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });
    const buffer = Buffer.from(mediaRes.data, 'binary');
    return buffer.toString('base64');
  } catch (err) {
    console.error("DOWNLOAD MEDIA ERROR:", err.message);
    return null;
  }
}

async function sendImageById(to, mediaId, caption) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { id: mediaId, caption: caption || "" }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.log("SEND IMAGE ID ERROR:", err.response?.data || err.message);
  }
}

async function sendImageWithButtons(to, imageUrl, bodyText, buttons) {
  try {
    const actionButtons = buttons.map(b => ({
      type: "reply",
      reply: { id: b.id, title: b.title }
    }));

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          header: {
            type: "image",
            image: { link: imageUrl }
          },
          body: { text: bodyText },
          action: { buttons: actionButtons }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.log("SEND IMAGE BUTTONS ERROR:", err.response?.data || err.message);
  }
}

module.exports = {
  sendMessage,
  sendListMessage,
  sendImageMessage,
  sendImageById,
  downloadMedia,
  sendImageWithButtons
};

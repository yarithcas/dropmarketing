// Simple marketing assistant using AIDA model and basic emotion-based angles.
document.addEventListener('DOMContentLoaded', () => {
  const emotions = ['joie', 'confiance', 'excitation', 'surprise', 'sécurité', 'bien‑être', 'facilité'];

  function generateResponse(product) {
    // Pick a random emotion for demonstration purposes
    const emotion = emotions[Math.floor(Math.random() * emotions.length)];
    return `Pour votre produit « ${product} », voici quelques angles marketing inspirés du modèle AIDA :\n\n` +
      `Attention : Attirez l’attention en mettant en avant une caractéristique unique de votre produit.\n` +
      `Intérêt : Expliquez comment ce produit apporte de la ${emotion} à vos clients et résout un problème spécifique.\n` +
      `Désir : Soulignez les bénéfices émotionnels (${emotion}) et montrez comment votre produit améliore leur quotidien.\n` +
      `Action : Incitez à l’action avec une offre spéciale, une garantie ou un appel à l’achat clair.`;
  }

  function appendMessage(text, role) {
    const log = document.getElementById('chat-log');
    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    // Preserve line breaks
    div.innerText = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function handleSend() {
    const input = document.getElementById('product-input');
    const text = input.value.trim();
    if (!text) return;
    appendMessage(text, 'user');
    const response = generateResponse(text);
    appendMessage(response, 'bot');
    input.value = '';
  }

  const sendBtn = document.getElementById('send-btn');
  const inputField = document.getElementById('product-input');

  if (sendBtn && inputField) {
    sendBtn.addEventListener('click', handleSend);
    inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSend();
      }
    });
  }
});
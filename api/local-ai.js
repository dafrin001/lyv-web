let pipeline = null;
let generator = null;
let modelReady = false;
let loadPromise = null;

const MODEL_PATH = window.location.origin + '/lyv-web/models/Llama-3.2-1B-Instruct-q4f16/';

// Respuestas de respaldo para cuando el modelo no cargue
const FALLBACK_RESPONSES = [
  "Gracias por compartir eso conmigo. ¿Cómo te hace sentir eso?",
  "Entiendo. Quiero que sepas que lo que sientes es válido. ¿Quieres contarme más?",
  "Estoy aquí para escucharte. A veces, solo hablar de lo que nos pasa ya ayuda un poco.",
  "Te agradezco que confíes en mí. ¿Hay algo específico que te gustaría abordar hoy?",
  "Es normal sentirse así. Respira profundo. Tómate tu tiempo, no hay prisa.",
  "Quiero que sepas que no estás solo/a en esto. ¿Has podido descansar estos días?",
  "A veces poner en palabras lo que sentimos ya es un gran paso. ¿Cómo has estado durmiendo?",
  "Me importa lo que me dices. ¿Qué crees que necesitas en este momento?",
  "Has mostrado mucha fortaleza al buscar apoyo. ¿Qué actividad solía gustarte antes?",
  "Lo que sientes tiene nombre y es válido. ¿Has hablado con alguien cercano sobre esto?",
  "A veces nuestra mente nos juega trampas. ¿Qué evidencia tienes de que eso es cierto?",
  "Respira conmigo: inhala profundo, sostén 4 segundos, exhala lento. ¿Mejor?",
  "Entiendo que esto puede ser difícil. Vamos paso a paso. ¿Por dónde te gustaría empezar?",
  "Estoy aquí, en este espacio seguro. No hay prisas ni juicios.",
  "A veces escribir lo que pensamos ayuda a ordenar la mente. ¿Has intentado llevar un diario?"
];

const RISK_RESPONSE = "Siento mucho que estés pasando por tanto dolor. Por favor, no estás solo/a. Hay ayuda disponible ahora mismo. ¿Puedes llamar a la línea de emergencia 123 o 106? Están capacitados para ayudarte. No tienes que pasar por esto solo/a.";

const SYSTEM_PROMPT = `Eres "Esperanza", un acompañante de apoyo emocional cálido, empático y seguro. Usa frases cortas. Valida sentimientos. No juzgues.`;

export async function loadLocalAI(onProgress) {
    if (modelReady) return true;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            if (onProgress) onProgress({ status: 'loading', message: 'Iniciando IA...' });

            const { pipeline: p } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.0');
            pipeline = p;

            if (onProgress) onProgress({ status: 'loading', message: 'Cargando modelo local...' });

            try {
                generator = await pipeline('text-generation', MODEL_PATH, {
                    progress_callback: (progress) => {
                        if (onProgress && progress.status === 'progress') {
                            const pct = Math.round((progress.loaded / progress.total) * 100);
                            onProgress({ status: 'downloading', progress: pct, message: `Cargando... ${pct}%` });
                        }
                    },
                    quantized: true
                });

                modelReady = true;
                if (onProgress) onProgress({ status: 'ready', message: 'IA local lista.' });
                return true;
            } catch (modelErr) {
                console.warn('Modelo local falló, usando respuestas de respaldo:', modelErr.message);

                // Marcar como listo con modo limitado (fallback activo)
                modelReady = true;
                if (onProgress) onProgress({
                    status: 'ready',
                    message: 'IA en modo texto (modelo neuronal no disponible)'
                });
                return true;
            }
        } catch (e) {
            console.error('Error crítico cargando IA:', e);

            // Modo fallback: la IA funcionará con respuestas predefinidas
            modelReady = true;
            if (onProgress) onProgress({
                status: 'ready',
                message: 'IA en modo texto'
            });
            return true;
        }
    })();

    return loadPromise;
}

export async function generateLocalResponse(messages, maxTokens = 256) {
    if (!modelReady) {
        throw new Error('Modelo no disponible');
    }

    // Detectar riesgo de suicidio en el último mensaje
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastText = (lastMsg?.content || '').toLowerCase();
    const riskWords = ['suicidio', 'morir', 'matarme', 'fin', 'adiós', 'pastillas', 'cortar', 'ahorcar', 'no quiero vivir', 'quitarme la vida'];
    const isRisk = riskWords.some(w => lastText.includes(w));
    if (isRisk) return RISK_RESPONSE;

    // Si el modelo neuronal está cargado, usarlo
    if (generator) {
        try {
            const history = messages
                .filter(m => {
                    const txt = m.content || (m.parts && m.parts[0] && m.parts[0].text) || '';
                    return txt.trim().length > 0;
                })
                .map(m => {
                    let txt = m.content;
                    if (!txt && m.parts && m.parts[0]) txt = m.parts[0].text;
                    let role = 'user';
                    if (m.sender === 'ai' || m.role === 'assistant' || m.role === 'model') role = 'assistant';
                    if (m.role === 'system' || m.sender === 'system') role = 'system';
                    return `${role}: ${txt}`;
                })
                .join('\n');

            const prompt = `${SYSTEM_PROMPT}\n\n${history}\nassistant:`;

            const result = await generator(prompt, {
                max_new_tokens: maxTokens,
                temperature: 0.6,
                do_sample: true,
                top_p: 0.9,
                repetition_penalty: 1.1,
            });

            let text = result[0]?.generated_text || '';
            const idx = text.lastIndexOf('assistant:');
            if (idx !== -1) text = text.substring(idx + 'assistant:'.length).trim();
            const cutoff = text.indexOf('\nuser:');
            if (cutoff !== -1) text = text.substring(0, cutoff).trim();

            if (text && text.length > 3) return text;
        } catch (e) {
            console.warn('Error generando respuesta, usando fallback:', e);
        }
    }

    // Fallback: respuesta predefinida contextual
    return getFallbackResponse(messages);
}

function getFallbackResponse(messages) {
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastText = (lastMsg?.content || '').toLowerCase();
    const msgCount = messages.filter(m => m.sender === 'user').length;

    // Respuestas contextuales básicas
    if (lastText.includes('gracias') || lastText.includes('gracias')) {
        return "De nada. Recuerda que estoy aquí para ti cuando me necesites. ¿Hay algo más en lo que pueda apoyarte?";
    }
    if (lastText.includes('hola') || lastText.includes('buen') || lastText.includes('hey')) {
        return "¡Hola! Me alegra verte por aquí. ¿Cómo te sientes hoy? Este es un espacio seguro para ti.";
    }
    if (lastText.includes('adiós') || lastText.includes('chao') || lastText.includes('nos vemos')) {
        return "Cuídate mucho. Recuerda que siempre puedes volver cuando quieras hablar. Estaré aquí para ti.";
    }
    if (lastText.includes('triste') || lastText.includes('llor')) {
        return "Siento que estés pasando por un momento triste. Está bien llorar, es parte de sanar. ¿Quieres contarme qué te tiene así?";
    }
    if (lastText.includes('ansiedad') || lastText.includes('ansios') || lastText.includes('nervios')) {
        return "La ansiedad puede ser muy abrumadora. Hagamos un ejercicio: nombra 5 cosas que puedas ver a tu alrededor, 4 que puedas tocar, 3 que puedas oír, 2 que puedas oler y 1 que puedas saborear. ¿Cómo te sientes ahora?";
    }
    if (lastText.includes('miedo') || lastText.includes('asust')) {
        return "El miedo es una emoción válida. ¿Qué es lo que te asusta exactamente? A veces hablar de ello ayuda a que pierda fuerza.";
    }
    if (lastText.includes('enoja') || lastText.includes('rabia') || lastText.includes('furios')) {
        return "El enojo es una emoción poderosa. Está bien sentirlo. ¿Qué crees que lo desencadenó? A veces escribir lo que sientes puede ayudar.";
    }
    if (lastText.includes('sol') || lastText.includes('solitari') || lastText.includes('solo ')) {
        return "La soledad pesa mucho, lo sé. Quiero que sepas que no estás solo/a. Estoy aquí contigo ahora. ¿Hay algo que solías disfrutar hacer?";
    }
    if (lastText.includes('cans') || lastText.includes('agot') || lastText.includes('fatig')) {
        return "El cansancio emocional es real. ¿Has podido descansar adecuadamente? A veces nuestro cuerpo y mente necesitan una pausa. ¿Qué tal si respiras profundo conmigo?";
    }
    if (lastText.includes('dormir') || lastText.includes('insomnio') || lastText.includes('desvel')) {
        return "Dormir bien es importante para nuestra salud mental. ¿Has intentado crear una rutina nocturna? Apagar pantallas una hora antes, leer algo tranquilo, o escuchar música suave puede ayudar.";
    }
    if (lastText.includes('comer') || lastText.includes('hambre') || lastText.includes('aliment')) {
        return "La alimentación también afecta nuestro estado de ánimo. ¿Has estado comiendo bien? A veces cuando estamos ansiosos olvidamos cuidar de nosotros mismos.";
    }
    if (lastText.includes('trabajo') || lastText.includes('estrés')) {
        return "El estrés laboral puede ser muy desgastante. ¿Has podido tomar pequeños descansos durante el día? Recuerda que tu salud es primero.";
    }
    if (lastText.includes('familia') || lastText.includes('mamá') || lastText.includes('papá') || lastText.includes('herman')) {
        return "Las relaciones familiares pueden ser complejas. A veces el amor y el dolor van de la mano. ¿Quieres contarme más sobre tu situación?";
    }
    if (lastText.includes('amigo') || lastText.includes('pareja') || lastText.includes('relación')) {
        return "Las relaciones interpersonales tienen sus altibajos. ¿Hay algo específico que te preocupa sobre esta relación?";
    }

    // Respuesta genérica rotativa según el número de mensajes
    const idx = msgCount % FALLBACK_RESPONSES.length;
    return FALLBACK_RESPONSES[idx];
}

export async function generateSessionSummary(messages) {
    if (!modelReady) return '';

    // Si el modelo neuronal está cargado, usarlo
    if (generator) {
        try {
            const history = messages
                .filter(m => {
                    if (m.role === 'system') return false;
                    const txt = m.content || '';
                    return txt.trim().length > 0;
                })
                .slice(-20)
                .map(m => {
                    const txt = m.content || '';
                    const role = (m.sender === 'ai' || m.role === 'assistant') ? 'asistente' : 'usuario';
                    return `${role}: ${txt}`;
                })
                .join('\n');

            if (!history.trim()) return '';

            const prompt = `Resume en 2-3 oraciones los temas principales y el estado emocional del usuario. Usa español.\n\n${history}\n\nResumen:`;

            const result = await generator(prompt, {
                max_new_tokens: 100,
                temperature: 0.3,
                do_sample: true,
            });
            let text = result[0]?.generated_text || '';
            const idx = text.lastIndexOf('Resumen:');
            if (idx !== -1) text = text.substring(idx + 'Resumen:'.length).trim();
            return text.split('\n')[0].trim();
        } catch (e) {
            console.warn('Error generando resumen:', e);
        }
    }

    // Resumen simple de respaldo
    const userMsgs = messages.filter(m => m.sender === 'user');
    if (userMsgs.length === 0) return '';
    return `Conversación de ${userMsgs.length} mensajes del usuario. Temas: ${userMsgs.slice(0, 3).map(m => (m.content || '').substring(0, 50)).join(', ')}`;
}

export function isModelReady() {
    return modelReady;
}

export function getModelInfo() {
    return {
        model: generator ? 'Llama-3.2-1B-Instruct-q4f16' : 'fallback-texto',
        ready: modelReady,
        type: generator ? 'local-transformers' : 'fallback'
    };
}

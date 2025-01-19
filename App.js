import { GEMINI_API_KEY } from '@env';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
  StyleSheet,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import { languages, translations, getTranslation } from './translations';

// Utility function to convert image to Base64
const imageToBase64 = async (uri) => {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const base64Data = result.split(',')[1]; // Remove the Data-URL prefix
          resolve(base64Data);
        } else {
          reject(new Error('Failed to read file as base64 string.'));
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting image to Base64:', error);
    throw error;
  }
};

// Function to interact with Gemini
const askLLM = async ({ prompt, base64Image, jsonMode = false, useWebSearch = false }) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;

  try {
    let contents = [{
      parts: [{ text: prompt }]
    }];

    if (base64Image) {
      contents[0].parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      });
    }

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contents }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get response from Gemini');
    }

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!result) {
      throw new Error('No response from Gemini.');
    }

    return result;
  } catch (error) {
    console.error('Error in askLLM:', error);
    throw new Error('Failed to get a response from Gemini.');
  }
};

// Function to send a request to FlashExp
const sendRequestToFlashExp = async (userPrompt, base64Image = undefined) => {
  try {
    const response = await askLLM({
      prompt: userPrompt,
      base64Image,
      jsonMode: false,
      useWebSearch: false,
    });
    return response;
  } catch (error) {
    console.error('Error sending request to GPT-4o:', error);
    throw new Error('Failed to get a response from GPT-4o.');
  }
};

// Function to send a request to the backend API
const sendRequestToApi = async (vocabulary, deckName) => {
  try {
    const vocabObject = {};
    vocabulary.forEach(entry => {
      vocabObject[entry.translated.trim()] = entry.original.trim();
    });

    const payload = {
      deck_name: deckName || 'Default Deck',
      vocabulary: vocabObject,
    };

    console.log('Sending request to proxy...');
    const response = await axios.post(
      '/.netlify/functions/anki-proxy',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      }
    );

    console.log('Response received from proxy');
    if (response.data) {
      // Check if we got an error response
      try {
        const textDecoder = new TextDecoder('utf-8');
        const textData = textDecoder.decode(response.data);
        const jsonData = JSON.parse(textData);
        if (jsonData.error) {
          throw new Error(jsonData.error);
        }
      } catch (e) {
        // If we can't parse as JSON, it's probably the file data
        console.log('Received binary data, creating download...');
      }

      const blob = new Blob([response.data], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${deckName || 'Anki-Cards'}.apkg`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { success: true };
    }

    throw new Error('Failed to generate Anki deck');
  } catch (error) {
    console.error('API request error:', error);
    let errorMessage = 'An unexpected error occurred.';

    if (error.response) {
      try {
        if (error.response.data instanceof ArrayBuffer) {
          const decoder = new TextDecoder('utf-8');
          const text = decoder.decode(error.response.data);
          try {
            const errorData = JSON.parse(text);
            errorMessage = errorData.error || errorData.message || t('Server error');
          } catch {
            errorMessage = text;
          }
        } else {
          errorMessage = error.response.data?.error || error.response.data?.message || t('Server error');
        }
      } catch {
        switch (error.response.status) {
          case 400:
            errorMessage = t('Bad Request');
            break;
          case 413:
            errorMessage = t('List too large');
            break;
          case 415:
            errorMessage = t('Invalid content type');
            break;
          case 429:
            errorMessage = t('Too many requests');
            break;
          case 500:
            errorMessage = t('Server error');
            break;
          default:
            errorMessage = `${t('Server error')} (${error.response.status})`;
        }
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = t('Request timeout');
    } else if (error.code === 'ERR_NETWORK') {
      errorMessage = t('Network error');
    } else if (error.request) {
      errorMessage = t('No server response');
    } else {
      errorMessage = error.message;
    }

    throw new Error(errorMessage);
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        maxWidth: 800,
        margin: '0 auto',
        height: '100vh',
        overflow: 'auto'
      }
    })
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
    color: '#666',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 10,
    height: 50,
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transition: 'opacity 0.2s',
        ':hover': {
          opacity: 0.8
        }
      }
    })
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    padding: 10,
    ...Platform.select({
      web: {
        maxWidth: 600,
        margin: '0 auto'
      }
    })
  },
  languageButton: {
    width: '48%',
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
    height: 70,
    justifyContent: 'center',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transition: 'all 0.2s',
        ':hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }
      }
    })
  },
  languageButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 4,
  },
  languageFlag: {
    fontSize: 24,
    marginBottom: 2,
  },
  inputButton: {
    backgroundColor: '#007AFF',
    padding: 20,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    height: 60,
    ...Platform.select({
      web: {
        maxWidth: 400,
        margin: '10px auto',
        cursor: 'pointer',
        transition: 'transform 0.2s',
        ':hover': {
          transform: 'translateY(-2px)'
        }
      }
    })
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    minHeight: 150,
    textAlignVertical: 'top',
    ...Platform.select({
      web: {
        maxWidth: 600,
        margin: '0 auto 20px',
        fontSize: 16
      }
    })
  },
  fixedButtonContainer: {
    ...Platform.select({
      web: {
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        paddingVertical: 15,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        borderTopColor: '#eee',
        maxWidth: 600,
        margin: '0 auto'
      }
    })
  },
  progressText: {
    fontSize: 18,
    marginTop: 10,
    textAlign: 'center',
  },
  wordListPreview: {
    fontSize: 16,
    padding: 10,
    ...Platform.select({
      web: {
        maxWidth: 600,
        margin: '0 auto'
      }
    })
  },
  secondaryButton: {
    backgroundColor: '#f0f0f0',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 10,
    height: 50,
    ...Platform.select({
      web: {
        maxWidth: 400,
        margin: '10px auto',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        ':hover': {
          backgroundColor: '#e0e0e0'
        }
      }
    })
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
  wordItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    ...Platform.select({
      web: {
        maxWidth: 600,
        margin: '0 auto 10px'
      }
    })
  },
  wordInputs: {
    marginLeft: 10,
    flex: 1,
  },
  textInputMultiline: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    marginBottom: 5,
    fontSize: 16,
    ...Platform.select({
      web: {
        minHeight: 40,
        resize: 'vertical'
      }
    })
  },
  answer: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    ...Platform.select({
      web: {
        maxWidth: 600,
        margin: '20px auto',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }
    })
  },
  scrollContainer: {
    flex: 1,
    ...Platform.select({
      web: {
        maxHeight: 'calc(100vh - 200px)',
        overflow: 'auto'
      }
    })
  },
  scrollContent: {
    ...Platform.select({
      web: {
        padding: '20px 0'
      }
    })
  },
  resultContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  successIconContainer: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderRadius: 50,
    padding: 20,
    marginBottom: 20,
  },
  resultTitle: {
    fontSize: 32,
    color: '#4CAF50',
    marginBottom: 10,
  },
  resultSubtitle: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  newDeckButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    minWidth: 250,
    transform: [{ scale: 1.1 }],
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        ':hover': {
          transform: [{ scale: 1.15 }],
          backgroundColor: '#45a049'
        }
      }
    })
  },
  newDeckIcon: {
    marginRight: 10,
  },
  newDeckButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
});

// UI Components
const WelcomeScreen = ({ onNext, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('Vocabulary Card Creator')}</Text>
      <Text style={styles.subtitle}>
        {t('Create Anki flashcards from text or images')}
      </Text>
      <TouchableOpacity onPress={onNext} style={styles.button}>
        <Text style={styles.buttonText}>{t('Get Started')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const LanguageScreen = ({ onSelectLanguage, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{t('Select Target Language')}</Text>
      <View style={styles.languageGrid}>
        {languages.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={styles.languageButton}
            onPress={() => onSelectLanguage(lang)}
          >
            <Text style={styles.languageFlag}>{lang.flag}</Text>
            <Text style={styles.languageButtonText}>{lang.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
};

const InputScreen = ({ onImageUpload, onTakePhoto, onTextInput, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('Choose Input Method')}</Text>
      <TouchableOpacity style={styles.inputButton} onPress={onImageUpload}>
        <Ionicons name="images" size={24} color="white" />
        <Text style={styles.buttonText}>{t('Upload Image')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.inputButton} onPress={onTakePhoto}>
        <Ionicons name="camera" size={24} color="white" />
        <Text style={styles.buttonText}>{t('Take Photo')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.inputButton} onPress={onTextInput}>
        <Ionicons name="create" size={24} color="white" />
        <Text style={styles.buttonText}>{t('Enter Text')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const TextInputScreen = ({ onSubmit, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);
  const [text, setText] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('Enter Text')}</Text>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
      >
        <TextInput
          style={styles.textInput}
          multiline
          placeholder={t('Paste your text here...')}
          value={text}
          onChangeText={setText}
        />
      </ScrollView>
      <View style={styles.fixedButtonContainer}>
        <TouchableOpacity
          style={[styles.button, !text && styles.buttonDisabled]}
          onPress={() => text && onSubmit(text)}
          disabled={!text}
        >
          <Text style={styles.buttonText}>{t('Create Flashcards')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const ProcessingScreen = ({ progress, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
      <Text style={styles.progressText}>{t(progress)}</Text>
    </View>
  );
};

const PreviewScreen = ({ wordList, onConfirm, onBack, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('Preview Word List')}</Text>
      <ScrollView 
        style={[styles.scrollContainer, { marginBottom: 140 }]}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        <Text style={styles.wordListPreview}>{wordList}</Text>
      </ScrollView>
      <View style={[styles.fixedButtonContainer, { backgroundColor: '#fff' }]}>
        <TouchableOpacity style={styles.button} onPress={onConfirm}>
          <Text style={styles.buttonText}>{t('Confirm and Send')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>{t('Back')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const SelectionScreen = ({
  words,
  onSubmit,
  setProcessing,
  deckName,
  selectedLanguage,
}) => {
  const t = (text) => getTranslation(selectedLanguage, text);
  const [selectedWords, setSelectedWords] = useState(
    words.map((w) => ({ ...w, selected: true })),
  );
  const [isLoading, setIsLoading] = useState(false);

  const updateWord = useCallback((index, field, value) => {
    setSelectedWords((prev) =>
      prev.map((word, i) => (i === index ? { ...word, [field]: value } : word)),
    );
  }, []);

  const toggleWord = useCallback((index) => {
    setSelectedWords((prev) =>
      prev.map((word, i) =>
        i === index ? { ...word, selected: !word.selected } : word,
      ),
    );
  }, []);

  const handleSubmit = async () => {
    setIsLoading(true);
    const finalWords = selectedWords.filter((w) => w.selected);
    console.log('Selected words count:', finalWords.length);

    if (finalWords.length === 0) {
      Alert.alert(t('Error'), t('Please select at least one word.'));
      setIsLoading(false);
      return;
    }

    try {
      setProcessing(t('Generating Anki deck...'));
      console.log('Sending to API:', finalWords.length, 'words');
      const result = await sendRequestToApi(finalWords, deckName);
      console.log('API response received');

      if (result.success) {
        Alert.alert(t('Success!'), t('Your Anki deck has been downloaded!'));
        onSubmit(null);
      } else {
        throw new Error(t('Failed to generate deck'));
      }
    } catch (error) {
      console.error('Error creating Anki deck:', error);
      Alert.alert(t('Error'), error.message);
    } finally {
      setProcessing('');
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{t('Select Words')}</Text>
      <Text style={styles.subtitle}>{t('Select Words and Translations')}</Text>
      {selectedWords.map((word, index) => (
        <View key={index} style={styles.wordItem}>
          <TouchableOpacity onPress={() => toggleWord(index)}>
            <Ionicons
              name={word.selected ? 'checkbox' : 'square-outline'}
              size={24}
              color="#007AFF"
            />
          </TouchableOpacity>
          <View style={styles.wordInputs}>
            <TextInput
              style={[styles.textInputMultiline]}
              value={word.translated}
              placeholder={t('Translation')}
              onChangeText={(text) => updateWord(index, 'translated', text)}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <TextInput
              style={[styles.textInputMultiline]}
              value={word.original}
              placeholder={t('Original')}
              onChangeText={(text) => updateWord(index, 'original', text)}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
          </View>
        </View>
      ))}
      {isLoading ? (
        <ActivityIndicator size="large" color="#007AFF" />
      ) : (
        <TouchableOpacity
          style={[
            styles.button,
            selectedWords.filter((w) => w.selected).length === 0 &&
              styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={
            selectedWords.filter((w) => w.selected).length === 0 || isLoading
          }
        >
          <Text style={styles.buttonText}>{t('Create Deck')}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
};

const ResultScreen = ({ onReset, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);

  return (
    <View style={[styles.container, styles.resultContainer]}>
      <View style={styles.successIconContainer}>
        <Ionicons name="checkmark-circle" size={80} color="#4CAF50" />
      </View>
      <Text style={[styles.title, styles.resultTitle]}>{t('Success!')}</Text>
      <Text style={[styles.subtitle, styles.resultSubtitle]}>{t('Your Anki deck has been downloaded!')}</Text>

      <TouchableOpacity 
        style={[styles.button, styles.newDeckButton]} 
        onPress={onReset}
      >
        <Ionicons name="add-circle-outline" size={24} color="white" style={styles.newDeckIcon} />
        <Text style={[styles.buttonText, styles.newDeckButtonText]}>{t('Create new deck')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const DeckTypeScreen = ({ onSelectType, content, selectedLanguage }) => {
  const t = (text) => getTranslation(selectedLanguage, text);

  const handleVocabulary = () => {
    onSelectType('vocabulary', content);
  };

  const handleQA = () => {
    onSelectType('qa', content);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('Choose Deck Type')}</Text>
      <Text style={styles.subtitle}>{t('What type of cards do you want to create?')}</Text>
      
      <TouchableOpacity style={styles.inputButton} onPress={handleVocabulary}>
        <Ionicons name="book" size={24} color="white" />
        <Text style={styles.buttonText}>{t('Vocabulary Cards')}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.inputButton} onPress={handleQA}>
        <Ionicons name="chatbubbles" size={24} color="white" />
        <Text style={styles.buttonText}>{t('Q&A Cards')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const RootApp = () => {
  const [step, setStep] = useState('language');
  const [selectedLanguage, setSelectedLanguage] = useState(null);
  const [processing, setProcessing] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [extractedWords, setExtractedWords] = useState([]);
  const [deckName, setDeckName] = useState('');
  const [inputText, setInputText] = useState('');

  const handleTakePhoto = async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        await processImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert(t('Error'), t('Could not take photo'));
    }
  };

  const handleImageUpload = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        await processImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert(t('Error'), t('Could not upload image'));
    }
  };

  const processImage = async (uri) => {
    try {
      setProcessing(t('Processing image...'));
      
      // Convert image to base64
      const base64Image = await imageToBase64(uri);
      
      const response = await askLLM({
        prompt: `Please analyze this image and extract any text or words you can find. Format the output as a simple list of words.`,
        base64Image,
        useWebSearch: false,
      });

      if (response) {
        setInputText(response);
        setProcessing('');
        handleTextProcessing(response);
      } else {
        throw new Error('Invalid API response');
      }
    } catch (error) {
      console.error('Error processing image:', error);
      Alert.alert(t('Error'), t('Image processing failed'));
      setProcessing('');
    }
  };

  const handleTextProcessing = async (text) => {
    try {
      setProcessing('Processing text...');
      setInputText(text);
      setStep('deckType'); // Go to deck type selection
    } catch (error) {
      console.error('Error processing text:', error);
      Alert.alert(
        'Error',
        'Failed to process text. Please try again.',
      );
    } finally {
      setProcessing('');
    }
  };

  const handleDeckTypeSelection = async (type, content) => {
    setProcessing('Generating cards...');
    try {
      // First, get a meaningful deck name from Gemini
      const deckNamePrompt = `Based on this text content, suggest a short, meaningful deck name (max 3-4 words) in ${selectedLanguage.name}. The name should reflect the main topic or theme. Return ONLY the name, nothing else:

${content.substring(0, 500)}...`;  // Only send first 500 chars for deck name generation

      const suggestedDeckName = await sendRequestToFlashExp(deckNamePrompt);
      setDeckName(suggestedDeckName.trim());

      if (type === 'vocabulary') {
        const prompt = `Extract vocabulary words from this text and translate them to ${selectedLanguage.name}. For each word:
1. Convert it to its base/dictionary form (lemma). For example:
   - German "gemeinsamen" or "gemeinsames" → "gemeinsam"
   - German "gehst", "ging", "gegangen" → "gehen"
   - English "running", "ran" → "run"
2. Keep the original word in parentheses if it differs from the base form.

Return ONLY a simple list where each line follows this format:
base_form (original_form);translated_word

If the word is already in its base form, omit the parentheses.
Example format:
gemeinsam (gemeinsamen);common
Haus;house

Here is the text:
${content}`;

        const wordList = await sendRequestToFlashExp(prompt);
        const words = wordList
          .split('\n')
          .map((w) => w.trim())
          .filter(Boolean)
          .map((line) => {
            const [original, translated] = line.split(';').map(w => w.trim());
            // Extract base form and original form if present
            const match = original.match(/^(.*?)(?:\s*\((.*?)\))?$/);
            if (match) {
              const [_, baseForm, originalForm] = match;
              return {
                original: originalForm || baseForm, // Use original form if available, otherwise base form
                translated: translated,
                baseForm: baseForm // Store base form for reference
              };
            }
            return { original, translated }; // Fallback
          });

        setExtractedWords(words);
        setStep('selection');
      } else if (type === 'qa') {
        const prompt = `You are an expert in creating Anki flashcards. Create question-answer pairs from the following text.
        The text is in the original language. Create questions and answers in the original language, 
        and add ${selectedLanguage.name} translations in parentheses.

        Follow these Anki best practices:
        - Questions should be specific and clear
        - Each question should test one concept
        - Answers should be concise
        - Avoid yes/no questions
        - Use the minimum information principle
        
        Format EXACTLY like this:
        F: [Original Question] (${selectedLanguage.name} translation of question)
        A: [Original Answer] (${selectedLanguage.name} translation of answer)

        Example format:
        F: Wo liegt Paris? (Where is Paris?)
        A: Paris liegt in Frankreich (Paris is in France)
        
        Text to process:
        ${content}`;

        const response = await sendRequestToFlashExp(prompt);
        const pairs = response
          .split('\n\n')
          .filter(Boolean)
          .map(pair => {
            const [question, answer] = pair.split('\n');
            return {
              translated: question.replace('F: ', '').trim(),
              original: answer.replace('A: ', '').trim()
            };
          });

        setExtractedWords(pairs);
        setStep('selection');
      }
    } catch (error) {
      console.error('Error:', error);
      Alert.alert('Error', 'Failed to generate cards. Please try again.');
    } finally {
      setProcessing('');
    }
  };

  const resetApp = () => {
    setStep('language');
    setSelectedLanguage(null);
    setProcessing('');
    setDownloadUrl('');
    setExtractedWords([]);
  };

  if (processing) {
    return <ProcessingScreen progress={processing} selectedLanguage={selectedLanguage} />;
  }

  switch (step) {
    case 'language':
      return (
        <LanguageScreen
          onSelectLanguage={(lang) => {
            setSelectedLanguage(lang);
            setStep('input');
          }}
          selectedLanguage={selectedLanguage}
        />
      );
    case 'input':
      return (
        <InputScreen
          onImageUpload={handleImageUpload}
          onTakePhoto={handleTakePhoto}
          onTextInput={() => setStep('text')}
          selectedLanguage={selectedLanguage}
        />
      );
    case 'text':
      return (
        <TextInputScreen
          onSubmit={(text) => {
            setInputText(text);
            handleTextProcessing(text);
          }}
          selectedLanguage={selectedLanguage}
        />
      );
    case 'selection':
      return (
        <SelectionScreen
          words={extractedWords}
          deckName={deckName}
          onSubmit={(downloadUrl) => {
            setDownloadUrl(downloadUrl);
            setStep('result');
          }}
          setProcessing={setProcessing}
          selectedLanguage={selectedLanguage}
        />
      );
    case 'result':
      return <ResultScreen onReset={resetApp} selectedLanguage={selectedLanguage} />;
    case 'deckType':
      return (
        <DeckTypeScreen
          onSelectType={handleDeckTypeSelection}
          content={inputText}
          selectedLanguage={selectedLanguage}
        />
      );
    default:
      return null;
  }
};

export default RootApp;

const express = require('express');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Trello API configuration
const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.TRELLO_BOARD_ID;

// List names mapping (you'll need to get the actual list IDs)
const LIST_MAPPING = {
  'Overdue': process.env.OVERDUE_LIST_ID,
  'Today': process.env.TODAY_LIST_ID,
  'Tomorrow': process.env.TOMORROW_LIST_ID,
  'This week': process.env.THIS_WEEK_LIST_ID,
  'Next week': process.env.NEXT_WEEK_LIST_ID,
  'Later': process.env.LATER_LIST_ID
};

// Helper function to get start and end of day
function getStartOfDay(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getEndOfDay(date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

// Helper function to get week boundaries
function getWeekBoundaries(date) {
  const start = new Date(date);
  const day = start.getDay();
  const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  const weekStart = new Date(start.setDate(diff));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  return {
    start: getStartOfDay(weekStart),
    end: getEndOfDay(weekEnd)
  };
}

// Determine which list a card should be in based on due date
function determineTargetList(dueDate) {
  if (!dueDate) return 'Later';
  
  const now = new Date();
  const due = new Date(dueDate);
  const today = getStartOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  
  const currentWeek = getWeekBoundaries(now);
  const nextWeek = getWeekBoundaries(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  
  // Overdue - due date is before today
  if (due < today) {
    return 'Overdue';
  }
  
  // Today - due date is today
  if (due >= today && due < getEndOfDay(today)) {
    return 'Today';
  }
  
  // Tomorrow - due date is tomorrow
  if (due >= tomorrow && due < getEndOfDay(tomorrow)) {
    return 'Tomorrow';
  }
  
  // This week - due date is in current week (after tomorrow)
  if (due >= getEndOfDay(tomorrow) && due <= currentWeek.end) {
    return 'This week';
  }
  
  // Next week - due date is in next week
  if (due >= nextWeek.start && due <= nextWeek.end) {
    return 'Next week';
  }
  
  // Later - everything else
  return 'Later';
}

// Get all cards from the board
async function getAllCards() {
  try {
    const response = await fetch(
      `https://api.trello.com/1/boards/${BOARD_ID}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&fields=id,name,due,idList`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const cards = await response.json();
    return cards;
  } catch (error) {
    console.error('Error fetching cards:', error);
    return [];
  }
}

// Move a card to a specific list
async function moveCard(cardId, listId) {
  try {
    const response = await fetch(
      `https://api.trello.com/1/cards/${cardId}?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idList: listId
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error moving card ${cardId}:`, error);
    return null;
  }
}

// Get list IDs and names for reference
async function getBoardLists() {
  try {
    const response = await fetch(
      `https://api.trello.com/1/boards/${BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&fields=id,name`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const lists = await response.json();
    console.log('Available lists:', lists);
    return lists;
  } catch (error) {
    console.error('Error fetching lists:', error);
    return [];
  }
}

// Main function to organize cards
async function organizeCards() {
  console.log('Starting card organization...');
  
  const cards = await getAllCards();
  console.log(`Found ${cards.length} cards`);
  
  let movedCount = 0;
  let errorCount = 0;
  
  for (const card of cards) {
    const targetListName = determineTargetList(card.due);
    const targetListId = LIST_MAPPING[targetListName];
    
    if (!targetListId) {
      console.warn(`No list ID configured for "${targetListName}"`);
      continue;
    }
    
    // Only move if the card is not already in the correct list
    if (card.idList !== targetListId) {
      console.log(`Moving card "${card.name}" to "${targetListName}"`);
      
      const result = await moveCard(card.id, targetListId);
      
      if (result) {
        movedCount++;
      } else {
        errorCount++;
      }
      
      // Add a small delay to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`Card organization complete. Moved: ${movedCount}, Errors: ${errorCount}`);
}

// Schedule the cron job to run every hour
cron.schedule('0 * * * *', async () => {
  console.log('Running scheduled card organization...');
  await organizeCards();
});

// Manual trigger endpoint for testing
app.get('/organize', async (req, res) => {
  try {
    await organizeCards();
    res.json({ success: true, message: 'Cards organized successfully' });
  } catch (error) {
    console.error('Error organizing cards:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Endpoint to check list configuration
app.get('/lists', async (req, res) => {
  try {
    const lists = await getBoardLists();
    res.json({ lists, mapping: LIST_MAPPING });
  } catch (error) {
    console.error('Error fetching lists:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Cron job scheduled to run every hour');
  
  // Run once on startup for testing
  if (process.env.NODE_ENV !== 'production') {
    setTimeout(organizeCards, 5000);
  }
});

module.exports = app;

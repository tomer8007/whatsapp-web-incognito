// This file defines a list of GUI element types that the WhatsApp Web page uses.
// The list can change in major WhatsApp Web updates. TODO: identify these dynamically based on React elements

var UIClassNames = {};

(function() {


if (document.getElementById("whatsapp-web"))
{
    // Seems to be WhatsApp version 2.3000+

    UIClassNames.MENU_ITEM_CLASS = "_ajv7";
    UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS = "_ajv9";
    
    UIClassNames.OUTER_DROPDOWN_CLASS = "_ak4w"; // outside class of dropdown with "mark as unread"
    UIClassNames.DROPDOWN_CLASS = "_ak5b";
    UIClassNames.DROPDOWN_ENTRY_CLASS = "_aj-r _aj-q _aj-_";
    
    UIClassNames.UNREAD_COUNTER_CLASS = "x18ba5f9"; // the class that sets background-color to var(--unread-marker-background)
    
    UIClassNames.CHAT_PANEL_CLASS = "x14yy4lh"; // the outermost chat panel class (was used in the past for safety delay feature)
    UIClassNames.INNER_CHAT_PANEL_CLASS = "x1cqoux5"; // the innermost chat panel class ('conversation-panel-messages')
    
    UIClassNames.CHAT_ENTRY_CLASS = "x10l6tqk "; // the chat entry in the chats list
    UIClassNames.UNREAD_MARKER_CLASS = "_agtk"; // the "X unread messages" warning inside the chat panel; the class inside the top-level item
    
    UIClassNames.CHAT_MESSAGE = "messag-in";
    UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV = "x1lliihq xh8yej3";
    
    
    UIClassNames.TEXT_WRAP_POSITION_CLASS = "_21Ahp";
    // TODO
    UIClassNames.DELETED_MESSAGE_SPAN = "_20bHr";
    UIClassNames.STICKER_MESSAGE_TAG = "_3mPXD";
}
else
{
    // Seems to be WhatsApp version 2.24

    UIClassNames.MENU_ITEM_CLASS = "_3OtEr";
    UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS = "_2Qn52";

    UIClassNames.OUTER_DROPDOWN_CLASS = "_2sDI2"; // outside class of dropdown with "mark as unread"
    UIClassNames.DROPDOWN_CLASS = "_3bcLp";
    UIClassNames.DROPDOWN_ENTRY_CLASS = "Iaqxu FCS6Q jScby";

    UIClassNames.UNREAD_COUNTER_CLASS = "ovhn1urg"; // the class that sets background-color to var(--unread-marker-background)

    UIClassNames.CHAT_PANEL_CLASS = "_2gzeB"; // the outermost chat panel class
    UIClassNames.INNER_CHAT_PANEL_CLASS = "_5kRIK"; // the innermost chat panel class ('conversation-panel-messages')

    UIClassNames.CHAT_ENTRY_CLASS = "rx9719la"; // the chat entry in the chats list
    UIClassNames.UNREAD_MARKER_CLASS = "_2jRew"; // the "X unread messages" warning inside the chat panel; the class inside the top-level item

    UIClassNames.CHAT_MESSAGE = "messag-in";
    UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV = "_21Ahp c4mcV";


    UIClassNames.TEXT_WRAP_POSITION_CLASS = "_21Ahp";
}
})();

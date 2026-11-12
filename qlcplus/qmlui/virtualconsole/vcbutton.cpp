/*
  Q Light Controller Plus
  vcbutton.cpp

  Copyright (c) Massimo Callegari

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0.txt

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

#include <QXmlStreamReader>
#include <QXmlStreamWriter>

#include "chaseraction.h"
#include "qlcmacros.h"
#include "vcbutton.h"
#include "vcframe.h"
#include "collection.h"
#include "chaser.h"
#include "tardis.h"
#include "doc.h"

/** ************** XML Tags and Attributes ************** */

#define KXMLQLCVCButtonFunction     QStringLiteral("Function")
#define KXMLQLCVCButtonFunctionID   QStringLiteral("ID")

#define KXMLQLCVCButtonAction           QStringLiteral("Action")
#define KXMLQLCVCButtonActionFlash      QStringLiteral("Flash")
#define KXMLQLCVCButtonActionToggle     QStringLiteral("Toggle")
#define KXMLQLCVCButtonActionBlackout   QStringLiteral("Blackout")
#define KXMLQLCVCButtonActionStopAll    QStringLiteral("StopAll")

#define KXMLQLCVCButtonFlashOverride    QStringLiteral("Override")
#define KXMLQLCVCButtonFlashForceLTP    QStringLiteral("ForceLTP")

#define KXMLQLCVCButtonStopAllFadeTime  QStringLiteral("FadeOut")

#define KXMLQLCVCButtonIntensity        QStringLiteral("Intensity")
#define KXMLQLCVCButtonIntensityAdjust  QStringLiteral("Adjust")

#define KXMLQLCVCButtonPalette          QStringLiteral("Palette")
#define KXMLQLCVCButtonPaletteSelected  QStringLiteral("Selected")
#define KXMLQLCVCButtonPaletteColor     QStringLiteral("Color")
#define KXMLQLCVCButtonPaletteRGB       QStringLiteral("RGB")
#define KXMLQLCVCButtonPaletteFunction  QStringLiteral("Function")

/** **************** External Control IDs ***************** */

#define INPUT_PRESSURE_ID   0

/** Every live button, to find the members of an exclusive group across frames and pages */
static QList<VCButton *> s_buttons;

VCButton::VCButton(Doc *doc, QObject *parent)
    : VCWidget(doc, parent)
    , m_functionID(Function::invalidId())
    , m_flashOverrides(false)
    , m_flashForceLTP(false)
    , m_state(Inactive)
    , m_actionType(Toggle)
    , m_stopAllFadeOutTime(0)
    , m_startupIntensityEnabled(false)
    , m_startupIntensity(1.0)
    , m_rampTimer(nullptr)
    , m_rampFid(Function::invalidId())
    , m_rampFrom(0)
    , m_rampTo(0)
    , m_rampCurrent(1)
    , m_rampMs(0)
    , m_rampStopAtEnd(false)
    , m_paletteIndex(-1)
{
    setType(VCWidget::ButtonWidget);
    s_buttons.append(this);

    registerExternalControl(INPUT_PRESSURE_ID, tr("Pressure"), true);
}

VCButton::~VCButton()
{
    s_buttons.removeAll(this);
    if (m_item)
        delete m_item;
}

QString VCButton::defaultCaption() const
{
    return tr("Button %1").arg(id() + 1);
}

void VCButton::setupLookAndFeel(qreal pixelDensity, int page)
{
    VCWidget::setupLookAndFeel(pixelDensity, page);

    setBackgroundColor(QColor("#444"));
}

void VCButton::render(QQuickView *view, QQuickItem *parent)
{
    if (view == nullptr || parent == nullptr)
        return;

    QQmlComponent *component = new QQmlComponent(view->engine(), QUrl("qrc:/VCButtonItem.qml"));

    if (component->isError())
    {
        qDebug() << component->errors();
        delete component;
        return;
    }

    m_item = qobject_cast<QQuickItem*>(component->create());
    if (m_item == nullptr)
        qWarning() << Q_FUNC_INFO << "Unable to create button component" << component->errors();
    delete component;
    if (m_item == nullptr)
        return;

    m_item->setParentItem(parent);
    m_item->setProperty("buttonObj", QVariant::fromValue(this));
}

QString VCButton::propertiesResource() const
{
    return QString("qrc:/VCButtonProperties.qml");
}

VCWidget *VCButton::createCopy(VCWidget *parent) const
{
    Q_ASSERT(parent != nullptr);

    VCButton *button = new VCButton(m_doc, parent);
    if (button->copyFrom(this) == false)
    {
        delete button;
        button = nullptr;
    }

    return button;
}

bool VCButton::copyFrom(const VCWidget* widget)
{
    const VCButton *button = qobject_cast <const VCButton*> (widget);
    if (button == nullptr)
        return false;

    /* Copy button-specific stuff */
    //setIconPath(button->iconPath()); // TODO ?
    setFunctionID(button->functionID());
    setStartupIntensityEnabled(button->startupIntensityEnabled());
    setStartupIntensity(button->startupIntensity());
    setStopAllFadeOutTime(button->stopAllFadeOutTime());
    setActionType(button->actionType());
    setState(button->state());

    setFlashForceLTP(button->flashForceLTP());
    setFlashOverride(button->flashOverrides());

    clearPalette();
    for (const PaletteEntry &e : button->palette())
        addPaletteEntry(e.first, e.second);
    setPaletteIndex(button->paletteIndex());

    /* Copy common stuff */
    return VCWidget::copyFrom(widget);
}

/*********************************************************************
 * Function attachment
 *********************************************************************/

void VCButton::setFunctionID(quint32 fid)
{
    bool running = false;

    if (m_functionID == fid)
        return;

    Function *current = m_doc->function(m_functionID);
    Function *function = m_doc->function(fid);

    if (current != nullptr)
    {
        /* Get rid of old function connections */
        disconnect(current, SIGNAL(running(quint32)),
                this, SLOT(slotFunctionRunning(quint32)));
        disconnect(current, SIGNAL(stopped(quint32)),
                this, SLOT(slotFunctionStopped(quint32)));
        disconnect(current, SIGNAL(flashing(quint32,bool)),
                this, SLOT(slotFunctionFlashing(quint32,bool)));

        if (current->isRunning())
        {
            running = true;
            current->stop(functionParent());
            resetIntensityOverrideAttribute();
        }

    }

    if (function != nullptr)
    {
        /* Connect to the new function */
        connect(function, SIGNAL(running(quint32)),
                this, SLOT(slotFunctionRunning(quint32)));
        connect(function, SIGNAL(stopped(quint32)),
                this, SLOT(slotFunctionStopped(quint32)));
        connect(function, SIGNAL(flashing(quint32,bool)),
                this, SLOT(slotFunctionFlashing(quint32,bool)));

        m_functionID = fid;
        if ((isEditing() && caption().isEmpty()) || caption() == defaultCaption())
            setCaption(function->name());

        if (running)
        {
            function->start(m_doc->masterTimer(), functionParent());
            setState(Active);
        }
        emit functionIDChanged(fid);
    }
    else
    {
        /* No function attachment */
        m_functionID = Function::invalidId();
        emit functionIDChanged(-1);
    }

    Tardis::instance()->enqueueAction(Tardis::VCButtonSetFunctionID, id(),
                                      current ? current->id() : Function::invalidId(),
                                      function ? function->id() : Function::invalidId());
}

quint32 VCButton::functionID() const
{
    return m_functionID;
}

void VCButton::adjustFunctionIntensity(Function *f, qreal value)
{
    qreal finalValue = startupIntensityEnabled() ? startupIntensity() * value : value;

    VCWidget::adjustFunctionIntensity(f, finalValue);
}

void VCButton::adjustIntensity(qreal val)
{
    VCWidget::adjustIntensity(val);

    if (state() == Active)
    {
        Function *f = m_doc->function(m_functionID);
        if (f == nullptr)
            return;

        adjustFunctionIntensity(f, val);
    }
}

void VCButton::notifyFunctionStarting(VCWidget *widget, quint32 fid, qreal fIntensity, bool excludeMonitored)
{
    Q_UNUSED(widget)
    Q_UNUSED(fIntensity)

    qDebug() << "notifyFunctionStarting" << widget->caption() << fid << fIntensity;

    if (fid == m_functionID || m_functionID == Function::invalidId())
        return;

    if (excludeMonitored)
    {
        // stop the controlled Function only if actively started
        // by this Button or if monitoring the startup Function
        if (state() != Active && m_functionID != m_doc->startupFunction())
            return;
    }

    if (actionType() == VCButton::Toggle)
    {
        Function *f = m_doc->function(m_functionID);
        if (f != NULL)
        {
            stopWithTransition(f, transitionFor(widget));
        }
    }
}

void VCButton::slotFunctionRunning(quint32 fid)
{
    if (fid == m_functionID && actionType() == Toggle)
    {
        if (state() == Inactive)
            setState(Monitoring);
        emit functionStarting(this, m_functionID);
    }
}

void VCButton::slotFunctionStopped(quint32 fid)
{
    if (fid == m_functionID && actionType() == Toggle)
    {
        resetIntensityOverrideAttribute();
        stopPaletteFunction();
        setState(Inactive);
    }
}

void VCButton::slotFunctionFlashing(quint32 fid, bool state)
{
    // Do not change the state of the button for Blackout or Stop All Functions buttons
    if (actionType() != Toggle && actionType() != Flash)
        return;

    if (fid != m_functionID)
        return;

    // if the function was flashed by another button, and the function is still running, keep the button pushed
    Function* f = m_doc->function(m_functionID);
    if (state == false && actionType() == Toggle && f != nullptr && f->isRunning())
    {
        return;
    }

    setState(state ? Active : Inactive);
}

FunctionParent VCButton::functionParent() const
{
    return FunctionParent(FunctionParent::ManualVCWidget, id());
}

/*****************************************************************************
 * Flash Properties
 *****************************************************************************/

bool VCButton::flashOverrides() const
{
    return m_flashOverrides;
}

void VCButton::setFlashOverride(bool shouldOverride)
{
    if (m_flashOverrides == shouldOverride)
        return;

    m_flashOverrides = shouldOverride;
    emit flashOverrideChanged(shouldOverride);
}

bool VCButton::flashForceLTP() const
{
    return m_flashForceLTP;
}

void VCButton::setFlashForceLTP(bool forceLTP)
{
    if (m_flashForceLTP == forceLTP)
        return;

    m_flashForceLTP = forceLTP;
    emit flashForceLTPChanged(forceLTP);
}

/*********************************************************************
 * Button state
 *********************************************************************/

VCButton::ButtonState VCButton::state() const
{
    return m_state;
}

void VCButton::setState(ButtonState state)
{
    if (state == m_state)
        return;

    m_state = state;

    emit stateChanged(m_state);

    updateFeedback();
}

void VCButton::setVisible(bool isVisible)
{
    // A Flash button relies on a release event to unflash. When it gets hidden
    // (e.g. its multipage frame switches page) while active, that release never
    // comes, leaving the button stuck on and the function flashed. Release it.
    if (isVisible == false && actionType() == Flash && state() == Active)
        requestStateChange(false);

    VCWidget::setVisible(isVisible);
}

void VCButton::requestStateChange(bool pressed)
{
    qDebug() << "Requested button state" << pressed;

    switch(actionType())
    {
        case Toggle:
        {
            Function *f = m_doc->function(m_functionID);
            if (f == NULL)
                return;

            // if the button is in a SoloFrame and the function is running but was
            // started by a different function (a chaser or collection), turn other
            // functions off and start this one.
            if (state() == Active && !(hasSoloParent() && f->startedAsChild()))
            {
                stopWithTransition(f, transitionFor(this));
                stopPaletteFunction();
                setState(Inactive);
            }
            else
            {
                adjustFunctionIntensity(f, intensity());

                // starting a Chaser is a special case, since it is necessary
                // to use Chaser Actions to properly start the first
                // Chaser step with the right intensity
                if (f->type() == Function::ChaserType || f->type() == Function::SequenceType)
                {
                    ChaserAction action;
                    action.m_action = ChaserSetStepIndex;
                    action.m_stepIndex = 0;
                    action.m_masterIntensity = intensity();
                    action.m_stepIntensity = 1.0;
                    action.m_fadeMode = Chaser::FromFunction;

                    Chaser *chaser = qobject_cast<Chaser*>(f);
                    chaser->setAction(action);
                }

                startWithTransition(f, transitionFor(this));
                startPaletteFunction();
                setState(Active);
                emit functionStarting(this, m_functionID);
                stopGroupMates();
            }
        }
        break;
        case Flash:
        {
            Function *f = m_doc->function(m_functionID);
            if (f != nullptr)
            {
                if (state() == Inactive && pressed == true)
                {
                    f->flash(m_doc->masterTimer(), flashOverrides(), flashForceLTP());
                    setState(Active);
                }
                else if (state() == Active && pressed == false)
                {
                    f->unFlash(m_doc->masterTimer());
                    setState(Inactive);
                }
            }
        }
        break;
        case Blackout:
        {
            m_doc->inputOutputMap()->toggleBlackout();
            setState(pressed ? Active : Inactive);
        }
        break;
        case StopAll:
        {
            if (stopAllFadeOutTime() == 0)
                m_doc->masterTimer()->stopAllFunctions();
            else
                m_doc->masterTimer()->fadeAndStopAll(stopAllFadeOutTime());
        }
        break;
        default:
        break;
    }

    Tardis::instance()->enqueueAction(Tardis::VCButtonSetPressed, id(), false, pressed);
}


/*********************************************************************
 * Color palette
 *********************************************************************/

QStringList VCButton::paletteColors() const
{
    QStringList list;
    for (const PaletteEntry &e : m_palette)
        list << e.first.name();
    return list;
}

QList<VCButton::PaletteEntry> VCButton::palette() const
{
    return m_palette;
}

int VCButton::paletteIndex() const
{
    return m_paletteIndex;
}

bool VCButton::paletteSelectable() const
{
    return m_palette.count() > 1;
}

void VCButton::clearPalette()
{
    if (m_palette.isEmpty())
        return;
    stopPaletteFunction();
    m_palette.clear();
    m_paletteIndex = -1;
    emit paletteChanged();
    emit paletteIndexChanged();
}

void VCButton::addPaletteEntry(const QColor &color, quint32 fid)
{
    m_palette.append(PaletteEntry(color, fid));
    if (m_paletteIndex < 0)
        m_paletteIndex = 0;
    emit paletteChanged();
    emit paletteIndexChanged();
}

void VCButton::setPaletteIndex(int index)
{
    if (m_palette.isEmpty() || index < 0 || index >= m_palette.count() || index == m_paletteIndex)
        return;

    /* Only a button that is really running owns a color Scene */
    bool live = (state() == Active);
    if (live)
        stopPaletteFunction();

    m_paletteIndex = index;

    if (live)
        startPaletteFunction();

    emit paletteIndexChanged();
}

QString VCButton::exclusiveGroup() const
{
    const VCWidget *w = this;
    while (w != nullptr)
    {
        w = qobject_cast<const VCWidget*>(w->parent());
        if (w == nullptr)
            break;
        if (w->type() == VCWidget::FrameWidget || w->type() == VCWidget::SoloFrameWidget)
        {
            QString group = static_cast<const VCFrame*>(w)->exclusiveGroup();
            if (!group.isEmpty())
                return group;
        }
    }
    return QString();
}

void VCButton::stopGroupMates()
{
    const QString group = exclusiveGroup();
    if (group.isEmpty())
        return;

    for (VCButton *other : s_buttons)
    {
        if (other == this || other->actionType() != Toggle || other->state() == Inactive)
            continue;
        if (other->functionID() == m_functionID || other->exclusiveGroup() != group)
            continue;

        other->notifyFunctionStarting(this, m_functionID, 1.0, false);
    }
}

int VCButton::transitionFor(const VCWidget *widget)
{
    const VCWidget *w = widget;
    while (w != nullptr)
    {
        w = qobject_cast<const VCWidget*>(w->parent());
        if (w == nullptr)
            break;
        if (w->type() == VCWidget::FrameWidget || w->type() == VCWidget::SoloFrameWidget)
        {
            int ms = static_cast<const VCFrame*>(w)->transitionMs();
            if (ms >= 0)
                return ms;
        }
    }
    return -1;
}

void VCButton::startRamp(quint32 fid, qreal from, qreal to, int ms, bool stopAtEnd)
{
    m_rampFid = fid;
    m_rampFrom = from;
    m_rampTo = to;
    m_rampCurrent = from;
    m_rampMs = qMax(1, ms);
    m_rampStopAtEnd = stopAtEnd;
    m_rampClock.start();

    if (m_rampTimer == nullptr)
    {
        m_rampTimer = new QTimer(this);
        m_rampTimer->setInterval(30);
        connect(m_rampTimer, SIGNAL(timeout()), this, SLOT(slotRampTick()));
    }
    m_rampTimer->start();
}

void VCButton::slotRampTick()
{
    Function *f = m_doc->function(m_rampFid);
    if (f == nullptr || f->isRunning() == false)
    {
        m_rampTimer->stop();
        return;
    }

    qreal k = qMin(qreal(1), qreal(m_rampClock.elapsed()) / qreal(m_rampMs));
    m_rampCurrent = m_rampFrom + (m_rampTo - m_rampFrom) * k;
    adjustFunctionIntensity(f, m_rampCurrent);

    if (k >= 1)
    {
        m_rampTimer->stop();
        if (m_rampStopAtEnd)
        {
            f->stop(functionParent());
            resetIntensityOverrideAttribute();
        }
    }
}

void VCButton::startWithTransition(Function *f, int ms)
{
    if (m_rampTimer != nullptr)
        m_rampTimer->stop();

    if (ms < 0)
    {
        f->start(m_doc->masterTimer(), functionParent());
        return;
    }

    if (f->type() == Function::SceneType)
    {
        f->start(m_doc->masterTimer(), functionParent(), 0, uint(ms), uint(ms));
        return;
    }

    /* the Function was still fading out: just ramp it back up from where it is */
    if (m_rampStopAtEnd && f->isRunning())
    {
        m_rampStopAtEnd = false;
        if (ms > 0)
            startRamp(f->id(), m_rampCurrent, intensity(), ms, false);
        else
            adjustFunctionIntensity(f, intensity());
        return;
    }

    if (ms > 0)
        adjustFunctionIntensity(f, 0);
    f->start(m_doc->masterTimer(), functionParent());
    if (ms > 0)
        startRamp(f->id(), 0, intensity(), ms, false);
}

void VCButton::stopWithTransition(Function *f, int ms)
{
    m_rampStopAtEnd = false;
    if (m_rampTimer != nullptr)
        m_rampTimer->stop();

    if (ms < 0)
    {
        f->stop(functionParent());
        resetIntensityOverrideAttribute();
        return;
    }

    if (f->type() == Function::SceneType)
    {
        f->setOverrideFadeOutSpeed(uint(ms));
        f->stop(functionParent());
        resetIntensityOverrideAttribute();
        return;
    }

    if (ms == 0 || f->isRunning() == false)
    {
        f->stop(functionParent());
        resetIntensityOverrideAttribute();
        return;
    }

    startRamp(f->id(), m_rampCurrent < 1 && m_rampFid == f->id() ? m_rampCurrent : intensity(), 0, ms, true);
}

FunctionParent VCButton::paletteParent() const
{
    /* A Function parent (not the widget): stopping a ManualVCWidget parent
     * clears every source of the Scene, while this one only removes its own,
     * so buttons sharing a color Scene do not switch it off for each other */
    return FunctionParent(FunctionParent::Function, m_functionID);
}

void VCButton::startPaletteFunction()
{
    if (m_paletteIndex < 0 || m_paletteIndex >= m_palette.count())
        return;

    Function *f = m_doc->function(m_palette.at(m_paletteIndex).second);
    if (f != nullptr)
    {
        int ms = transitionFor(this);
        if (ms >= 0)
            f->start(m_doc->masterTimer(), paletteParent(), 0, uint(ms), uint(ms));
        else
            f->start(m_doc->masterTimer(), paletteParent());
    }
}

void VCButton::stopPaletteFunction()
{
    if (m_paletteIndex < 0 || m_paletteIndex >= m_palette.count())
        return;

    Function *f = m_doc->function(m_palette.at(m_paletteIndex).second);
    if (f != nullptr)
    {
        int ms = transitionFor(this);
        if (ms >= 0)
            f->setOverrideFadeOutSpeed(uint(ms));
        f->stop(paletteParent());
    }
}

/*********************************************************************
 * Button action
 *********************************************************************/

VCButton::ButtonAction VCButton::actionType() const
{
    return m_actionType;
}

void VCButton::setActionType(ButtonAction actionType)
{
    if (m_actionType == actionType)
        return;

    Tardis::instance()->enqueueAction(Tardis::VCButtonSetActionType, id(), m_actionType, actionType);

    m_actionType = actionType;
    emit actionTypeChanged(actionType);
}

QString VCButton::actionToString(VCButton::ButtonAction action)
{
    if (action == Flash)
        return QString(KXMLQLCVCButtonActionFlash);
    else if (action == Blackout)
        return QString(KXMLQLCVCButtonActionBlackout);
    else if (action == StopAll)
        return QString(KXMLQLCVCButtonActionStopAll);
    else
        return QString(KXMLQLCVCButtonActionToggle);
}

VCButton::ButtonAction VCButton::stringToAction(const QString& str)
{
    if (str == KXMLQLCVCButtonActionFlash)
        return Flash;
    else if (str == KXMLQLCVCButtonActionBlackout)
        return Blackout;
    else if (str == KXMLQLCVCButtonActionStopAll)
        return StopAll;
    else
        return Toggle;
}

void VCButton::setStopAllFadeOutTime(int ms)
{
    if (ms == m_stopAllFadeOutTime)
        return;

    m_stopAllFadeOutTime = ms;
    emit stopAllFadeOutTimeChanged();
}

int VCButton::stopAllFadeOutTime() const
{
    return m_stopAllFadeOutTime;
}


/*****************************************************************************
 * Function startup intensity adjustment
 *****************************************************************************/

bool VCButton::startupIntensityEnabled() const
{
    return m_startupIntensityEnabled;
}

void VCButton::setStartupIntensityEnabled(bool enable)
{
    if (enable == m_startupIntensityEnabled)
        return;

    Tardis::instance()->enqueueAction(Tardis::VCButtonEnableStartupIntensity, id(), m_startupIntensityEnabled, enable);

    m_startupIntensityEnabled = enable;
    emit startupIntensityEnabledChanged();
}

qreal VCButton::startupIntensity() const
{
    return m_startupIntensity;
}

void VCButton::setStartupIntensity(qreal fraction)
{
    if (fraction == m_startupIntensity)
        return;

    qreal newVal = CLAMP(fraction, qreal(0), qreal(1));
    Tardis::instance()->enqueueAction(Tardis::VCButtonSetStartupIntensity, id(), m_startupIntensity, newVal);

    m_startupIntensity = newVal;
    emit startupIntensityChanged();
}

/*********************************************************************
 * External input
 *********************************************************************/

void VCButton::updateFeedback()
{
    if (m_state == Inactive)
        sendFeedback(0, INPUT_PRESSURE_ID, VCWidget::LowerValue);
    else if (m_state == Monitoring)
        sendFeedback(0, INPUT_PRESSURE_ID, VCWidget::MonitorValue);
    else
        sendFeedback(UCHAR_MAX, INPUT_PRESSURE_ID, VCWidget::UpperValue);
}

void VCButton::slotInputValueChanged(quint8 id, uchar value)
{
    if (id != INPUT_PRESSURE_ID)
        return;

    if (actionType() == Flash)
    {
        if (state() == Inactive && value > 0)
            requestStateChange(true);
        else if (state() == Active && value == 0)
            requestStateChange(false);
    }
    else
    {
        if (value > 0 && state() == Inactive)
            requestStateChange(true);
        else if (value > 0 && state() == Active)
            requestStateChange(false);
    }
}

/*********************************************************************
 * Load & Save
 *********************************************************************/

bool VCButton::loadXML(QXmlStreamReader &root)
{
    if (root.name() != KXMLQLCVCButton)
    {
        qWarning() << Q_FUNC_INFO << "Button node not found";
        return false;
    }

    /* Widget commons */
    loadXMLCommon(root);

    while (root.readNextStartElement())
    {
        if (root.name() == KXMLQLCWindowState)
        {
            bool visible = false;
            int x = 0, y = 0, w = 0, h = 0;
            loadXMLWindowState(root, &x, &y, &w, &h, &visible);
            setGeometry(QRect(x, y, w, h));
        }
        else if (root.name() == KXMLQLCVCWidgetAppearance)
        {
            loadXMLAppearance(root);
        }
        else if (root.name() == KXMLQLCVCButtonFunction)
        {
            QString str = root.attributes().value(KXMLQLCVCButtonFunctionID).toString();
            setFunctionID(str.toUInt());
            root.skipCurrentElement();
        }
        else if (root.name() == KXMLQLCVCButtonAction)
        {
            QXmlStreamAttributes attrs = root.attributes();
            if (attrs.hasAttribute(KXMLQLCVCButtonStopAllFadeTime))
                setStopAllFadeOutTime(attrs.value(KXMLQLCVCButtonStopAllFadeTime).toInt());

            if (attrs.hasAttribute(KXMLQLCVCButtonFlashOverride))
                    setFlashOverride(attrs.value(KXMLQLCVCButtonFlashOverride).toInt());

            if (attrs.hasAttribute(KXMLQLCVCButtonFlashForceLTP))
                    setFlashForceLTP(attrs.value(KXMLQLCVCButtonFlashForceLTP).toInt());

            setActionType(stringToAction(root.readElementText()));
        }
        else if (root.name() == KXMLQLCVCButtonIntensity)
        {
            bool adjust;
            if (root.attributes().value(KXMLQLCVCButtonIntensityAdjust).toString() == KXMLQLCTrue)
                adjust = true;
            else
                adjust = false;
            setStartupIntensity(qreal(root.readElementText().toInt()) / qreal(100));
            setStartupIntensityEnabled(adjust);
        }
        else if (root.name() == KXMLQLCVCButtonPalette)
        {
            int selected = root.attributes().value(KXMLQLCVCButtonPaletteSelected).toInt();
            clearPalette();
            while (root.readNextStartElement())
            {
                if (root.name() == KXMLQLCVCButtonPaletteColor)
                {
                    QXmlStreamAttributes attrs = root.attributes();
                    QColor col(attrs.value(KXMLQLCVCButtonPaletteRGB).toString());
                    quint32 fid = attrs.hasAttribute(KXMLQLCVCButtonPaletteFunction) ?
                                  attrs.value(KXMLQLCVCButtonPaletteFunction).toUInt() : Function::invalidId();
                    if (col.isValid())
                        addPaletteEntry(col, fid);
                }
                root.skipCurrentElement();
            }
            setPaletteIndex(selected);
        }
        else if (root.name() == KXMLQLCVCWidgetInput)
        {
            loadXMLInputSource(root, INPUT_PRESSURE_ID);
        }
        else if (root.name() == KXMLQLCVCWidgetKey)
        {
            loadXMLInputKey(root, INPUT_PRESSURE_ID);
        }
        else
        {
            qWarning() << Q_FUNC_INFO << "Unknown button tag:" << root.name().toString();
            root.skipCurrentElement();
        }
    }

    return true;
}

bool VCButton::saveXML(QXmlStreamWriter *doc) const
{
    Q_ASSERT(doc != nullptr);

    /* VC button entry */
    doc->writeStartElement(KXMLQLCVCButton);

    saveXMLCommon(doc);

    /* Window state */
    saveXMLWindowState(doc);

    /* Appearance */
    saveXMLAppearance(doc);

    /* Function */
    doc->writeStartElement(KXMLQLCVCButtonFunction);
    doc->writeAttribute(KXMLQLCVCButtonFunctionID, QString::number(functionID()));
    doc->writeEndElement();

    /* Action */
    doc->writeStartElement(KXMLQLCVCButtonAction);

    if (actionType() == StopAll && stopAllFadeOutTime() != 0)
    {
        doc->writeAttribute(KXMLQLCVCButtonStopAllFadeTime, QString::number(stopAllFadeOutTime()));
    }
    else if (actionType() == Flash)
    {
        doc->writeAttribute(KXMLQLCVCButtonFlashOverride, QString::number(flashOverrides()));
        doc->writeAttribute(KXMLQLCVCButtonFlashForceLTP, QString::number(flashForceLTP()));
    }

    doc->writeCharacters(actionToString(actionType()));
    doc->writeEndElement();

    /* External control */
    saveXMLInputControl(doc, INPUT_PRESSURE_ID, false);

    /* Intensity adjustment */
    if (startupIntensityEnabled())
    {
        doc->writeStartElement(KXMLQLCVCButtonIntensity);
        doc->writeCharacters(QString::number(int(startupIntensity() * 100)));
        doc->writeEndElement();
    }

    /* Color palette */
    if (!m_palette.isEmpty())
    {
        doc->writeStartElement(KXMLQLCVCButtonPalette);
        doc->writeAttribute(KXMLQLCVCButtonPaletteSelected, QString::number(qMax(0, m_paletteIndex)));
        for (const PaletteEntry &e : m_palette)
        {
            doc->writeStartElement(KXMLQLCVCButtonPaletteColor);
            doc->writeAttribute(KXMLQLCVCButtonPaletteRGB, e.first.name());
            if (e.second != Function::invalidId())
                doc->writeAttribute(KXMLQLCVCButtonPaletteFunction, QString::number(e.second));
            doc->writeEndElement();
        }
        doc->writeEndElement();
    }

    /* End the <Button> tag */
    doc->writeEndElement();

    return true;
}

/**
 * 设计：
 *
 * Popover组件只是一个壳子，负责组装Trigger和Content。
 *
 * 弹层实际的打开／关闭都是Content完成的，而什么情况打开弹层是Trigger控制的。
 *
 * Popover 组件是一个递归的组件，支持嵌套。
 *
 *
 *            context                       context
 *            ------>                       ------>
 * Popover               Popover child                    Popover grand-child     ......
 *            <------                       <------
 *        isOutsideStacked              isOutsideStacked
 *
 */

import React, { Component, Children } from 'react';
import ReactDOM from 'react-dom';
import cx from 'zent-utils/classnames';
import noop from 'zent-utils/lodash/noop';
import uniqueId from 'zent-utils/lodash/uniqueId';
import isFunction from 'zent-utils/lodash/isFunction';
import isBoolean from 'zent-utils/lodash/isBoolean';
import isPromise from 'zent-utils/isPromise';

import PopoverContent from './Content';
import PropTypes from 'zent-utils/prop-types';
import PopoverTrigger from './trigger/Trigger';

const SKIPPED = () => {};

function instanceOf(MaybeDerive, Base) {
  return MaybeDerive === Base || MaybeDerive.prototype instanceof Base;
}

function handleBeforeHook(beforeFn, arity, continuation) {
  // 有参数，传入continuation，由外部去控制何时调用
  if (arity >= 1) {
    return beforeFn(continuation);
  }

  // 无参数，如果返回Promise那么resolve后调用continuation；如果返回不是Promise，直接调用Promise
  const mayBePromise = beforeFn();
  if (!isPromise(mayBePromise) && mayBePromise !== SKIPPED) {
    return continuation();
  }

  mayBePromise.then(continuation);
}

export const PopoverContextType = {
  popover: PropTypes.shape({
    close: PropTypes.func.isRequired,
    open: PropTypes.func.isRequired,
    getContentNode: PropTypes.func.isRequired,
    getTriggerNode: PropTypes.func.isRequired,

    // 用于维护 Popover 栈，处理嵌套的问题
    registerDescendant: PropTypes.func,
    unregisterDescendant: PropTypes.func
  })
};

export default class Popover extends Component {
  static propTypes = {
    prefix: PropTypes.string,
    className: PropTypes.string,

    // custom classname for trigger wrapper
    wrapperClassName: PropTypes.string,

    // container的display属性
    display: PropTypes.string,

    // position strategy
    position: PropTypes.func.isRequired,

    // 定位时的偏移量
    cushion: PropTypes.number,

    // 只有用户触发的打开／关闭才会触发这两个毁掉
    onBeforeClose: PropTypes.func,
    onBeforeShow: PropTypes.func,

    // 不管打开／关闭时如何触发的都会被调用
    onClose: PropTypes.func,
    onShow: PropTypes.func,

    // defaults to body
    containerSelector: PropTypes.string,

    children: PropTypes.node.isRequired,

    // 两个必须一起出现
    visible: PropTypes.bool,
    onVisibleChange: PropTypes.func
  };

  static defaultProps = {
    prefix: 'zent',
    className: '',
    wrapperClassName: '',
    display: 'block',
    onBeforeClose: noop,
    onBeforeShow: noop,
    onClose: noop,
    onShow: noop,
    cushion: 0,
    containerSelector: 'body'
  };

  static contextTypes = PopoverContextType;

  static childContextTypes = PopoverContextType;

  getChildContext() {
    return {
      popover: {
        close: this.close,
        open: this.open,
        getContentNode: this.getPopoverNode,
        getTriggerNode: this.getTriggerNode,

        registerDescendant: this.registerDescendant,
        unregisterDescendant: this.unregisterDescendant
      }
    };
  }

  registerDescendant = (popover) => {
    this.descendants.push(popover);
  };

  unregisterDescendant = (popover) => {
    const idx = this.descendants.indexOf(popover);
    this.descendants.splice(idx, 1);
  }

  constructor(props) {
    super(props);

    // id用来唯一标识popover实例
    this.id = uniqueId(`${props.prefix}-popover-internal-id-`);

    // 记录 Popover 子孙
    this.descendants = [];

    if (!this.isVisibilityControlled(props)) {
      this.state = {
        visible: false
      };
    }
  }

  isVisibilityControlled(props) {
    const { visible, onVisibleChange } = props || this.props;
    const hasOnChange = isFunction(onVisibleChange);
    const hasVisible = isBoolean(visible);

    if (hasVisible && !hasOnChange || hasOnChange && !hasVisible) {
      throw new Error('visible and onVisibleChange must be used together');
    }

    return hasVisible && hasOnChange;
  }

  getVisible = (props, state) => {
    if (this.isVisibilityControlled(props)) {
      props = props || this.props;
      return props.visible;
    }

    state = state || this.state;
    return state.visible;
  };

  setVisible = (visible, props, state) => {
    props = props || this.props;
    state = state || this.state;
    const beforeHook = visible ? props.onBeforeShow : props.onBeforeClose;
    const onBefore = (...args) => {
      // 确保pending的时候不会触发多次beforeHook
      if (this.pendingOnBeforeHook) {
        return SKIPPED;
      }

      this.pendingOnBeforeHook = true;
      return beforeHook(...args);
    };

    if (this.isVisibilityControlled(props)) {
      if (this.pendingOnBeforeHook || props.visible === visible) {
        return;
      }

      handleBeforeHook(onBefore, beforeHook.length, () => {
        props.onVisibleChange(visible);
        this.pendingOnBeforeHook = false;
      });
    } else {
      if (this.pendingOnBeforeHook || state.visible === visible) {
        return;
      }

      handleBeforeHook(onBefore, beforeHook.length, () => {
        this.setState({ visible });
        this.pendingOnBeforeHook = false;
      });
    }
  }

  getPopoverNode = () => {
    return document.querySelector(`.${this.id}`);
  }

  onTriggerRefChange = (triggerInstance) => {
    this.triggerNode = ReactDOM.findDOMNode(triggerInstance);
  };

  getTriggerNode = () => {
    return this.triggerNode;
  };

  open = () => {
    this.setVisible(true);
  };

  close = () => {
    this.setVisible(false);
  };

  injectIsOutsideSelf = (impl) => {
    this.isOutsideSelf = impl;
  };

  // Popover up in the tree will call this method to see if the node lies outside
  isOutsideStacked = (node) => {
    if (this.isOutsideSelf) {
      // 在自身内部，肯定不在外面
      if (!this.isOutsideSelf(node)) {
        return false;
      }
    }

    // 问下面的 Popover 是否在外面
    if (this.descendants.some(popover => !popover.isOutsideStacked(node))) {
      return false;
    }

    return true;
  };

  validateChildren() {
    const { children } = this.props;
    const childArray = Children.toArray(children);

    if (childArray.length !== 2) {
      throw new Error('There must be one and only one trigger and content in Popover');
    }

    const { trigger, content } = childArray.reduce((state, c) => {
      const type = c.type;
      if (instanceOf(type, PopoverTrigger)) {
        state.trigger = c;
      } else if (instanceOf(type, PopoverContent)) {
        state.content = c;
      }

      return state;
    }, { trigger: null, content: null });

    if (!trigger) {
      throw new Error('Missing trigger in Popover');
    }
    if (!content) {
      throw new Error('Missing content in Popover');
    }

    return { trigger, content };
  }

  componentDidMount() {
    const { popover } = this.context || {};
    if (popover && popover.registerDescendant) {
      popover.registerDescendant(this);
    }

    if (this.isVisibilityControlled() && this.props.visible) {
      this.props.onShow();
    }
  }

  componentDidUpdate(prevProps, prevState) {
    const visible = this.getVisible();
    if (visible !== this.getVisible(prevProps, prevState)) {
      const afterHook = visible ? this.props.onShow : this.props.onClose;
      afterHook();
    }
  }

  componentWillUnmount() {
    const { popover } = this.context || {};
    if (popover && popover.unregisterDescendant) {
      popover.unregisterDescendant(this);
    }
  }

  render() {
    const { trigger, content } = this.validateChildren();
    const { display, prefix, className, wrapperClassName, containerSelector, position, cushion } = this.props;
    const visible = this.getVisible();

    return (
      <div style={{ display }} className={cx(`${prefix}-popover-wrapper`, wrapperClassName)}>
        {React.cloneElement(trigger, {
          prefix,
          contentVisible: visible,
          onTriggerRefChange: this.onTriggerRefChange,
          getTriggerNode: this.getTriggerNode,
          getContentNode: this.getPopoverNode,
          open: this.open,
          close: this.close,
          isOutsideStacked: this.isOutsideStacked,
          injectIsOutsideSelf: this.injectIsOutsideSelf
        })}
        {React.cloneElement(content, {
          prefix,
          className,
          id: this.id,
          getContentNode: this.getPopoverNode,
          getAnchor: this.getTriggerNode,
          visible,
          cushion,
          containerSelector,
          placement: position
        })}
      </div>
    );
  }
}
